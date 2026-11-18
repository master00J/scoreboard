/**
 * Verwerkt één lading commando's uit de cloud-wachtrij: elk commando uitvoeren (hoogstens één keer
 * per id, zie `server/cloud-command-ledger.ts`) en daarna bevestigen. Alleen de bevestiging wordt bij
 * een fout opnieuw geprobeerd, nooit het commando. Lukt ook dat niet, dan levert de cloud het commando
 * bij de volgende poll opnieuw en wordt alleen de bevestiging nog eens gestuurd.
 */

export type CloudCommandItem = { id?: unknown; command?: unknown };

export type CloudAck = { ok: boolean; error?: string; result?: unknown };

export type CloudRelayDeps = {
  /** Voert het commando uit, tenzij dit id al uitgevoerd is (`duplicate`). */
  apply: (commandId: string, command: unknown) => Promise<{ ack: CloudAck; duplicate: boolean }>;
  /** Stuurt de bevestiging; gooit `CloudAckError` als de cloud ze niet aanvaardde. */
  postAck: (commandId: string, ack: CloudAck) => Promise<void>;
  /** Noteert dat de cloud de bevestiging aanvaardde. */
  markAcked: (commandId: string) => Promise<void>;
  log: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Wachttijd vóór elke nieuwe poging; het aantal bepaalt het aantal extra pogingen. */
  ackRetryDelaysMs?: readonly number[];
};

/** Kort gehouden: tijdens het wachten staan de volgende commando's en de stand-upload stil. */
export const DEFAULT_ACK_RETRY_DELAYS_MS = [300, 1000, 2500] as const;

export class CloudAckError extends Error {
  /** Een nieuwe poging kan helpen (netwerk, 5xx, 429, 408). Bij 401/403/422 niet. */
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "CloudAckError";
    this.retryable = retryable;
  }
}

export function isRetryableAckStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

/**
 * Controleert het antwoord op een bevestiging: HTTP 2xx én `{ ok: true }` in de body. Een
 * proxy-pagina of een lege 200 telt niet als aanvaard.
 */
export function checkAckResponse(status: number, body: unknown): void {
  const bodyOk = !!body && typeof body === "object" && (body as { ok?: unknown }).ok === true;
  if (status >= 200 && status < 300 && bodyOk) return;
  const message =
    body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : "";
  const retryable = status >= 200 && status < 300 ? true : isRetryableAckStatus(status);
  throw new CloudAckError(`bevestiging geweigerd (${status})${message ? `: ${message}` : ""}`, retryable);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Probeert de bevestiging tot ze aanvaard is. Geeft `true` als de cloud ze aanvaardde. */
export async function sendAckWithRetry(
  commandId: string,
  ack: CloudAck,
  deps: Pick<CloudRelayDeps, "postAck" | "log" | "sleep" | "ackRetryDelaysMs">,
): Promise<boolean> {
  const delays = deps.ackRetryDelaysMs ?? DEFAULT_ACK_RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.postAck(commandId, ack);
      return true;
    } catch (err) {
      // Netwerkfouten (fetch gooit, time-out) zijn het schoolvoorbeeld van iets dat opnieuw kan.
      const retryable = err instanceof CloudAckError ? err.retryable : true;
      if (!retryable || attempt >= delays.length) {
        deps.log(
          `[cloud-control] bevestiging van ${commandId} niet aangekomen (${errorText(err)}); ` +
            "de cloud levert het opnieuw en het wordt dan alleen opnieuw bevestigd",
        );
        return false;
      }
      await sleep(delays[attempt]);
    }
  }
}

export async function relayCloudCommands(items: readonly CloudCommandItem[], deps: CloudRelayDeps): Promise<void> {
  for (const item of items) {
    const commandId = typeof item?.id === "string" ? item.id.trim() : "";
    if (!commandId) continue;

    let ack: CloudAck;
    try {
      const outcome = await deps.apply(commandId, item.command);
      ack = { ok: !!outcome.ack.ok, error: outcome.ack.error, result: outcome.ack.result };
    } catch (err) {
      // De runtime vangt zelf alle fouten op; komt er toch één door, dan is de transactie niet
      // doorgegaan en is er niets gewijzigd.
      ack = { ok: false, error: errorText(err) };
    }

    if (await sendAckWithRetry(commandId, ack, deps)) {
      try {
        await deps.markAcked(commandId);
      } catch (err) {
        deps.log(`[cloud-control] bevestiging van ${commandId} niet genoteerd: ${errorText(err)}`);
      }
    }
  }
}
