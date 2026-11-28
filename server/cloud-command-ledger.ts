import type { Prisma, PrismaClient } from "@prisma/client";
import type { CommandAck } from "../lib/desktop-bridge";
import { isCommandUserError } from "../lib/command-user-error";

/**
 * Elk commando uit de cloud-wachtrij wordt hier hoogstens één keer uitgevoerd.
 *
 * De cloud levert een commando opnieuw zolang ze geen bevestiging kreeg. Mislukt die bevestiging
 * (netwerk, site even weg), dan komt hetzelfde commando bij de volgende poll terug. Het id staat dan
 * al in `AppliedCloudCommand`, in dezelfde SQLite-transactie geschreven als de wijziging zelf: ofwel
 * staan ze er allebei, ofwel geen van beide. Een herhaalde levering wordt niet uitgevoerd, alleen
 * opnieuw bevestigd met de oorspronkelijke uitkomst.
 */

/** Na een aanvaarde bevestiging levert de cloud het commando niet meer; een dag bewaren is ruim. */
export const ACKED_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Kwam de bevestiging nooit aan (pc lang offline), dan nog zo lang onthouden voor een late levering. */
export const UNACKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

type Tx = Prisma.TransactionClient;
type Db = Pick<PrismaClient, "$transaction" | "appliedCloudCommand">;

export type CloudCommandOutcome = {
  ack: CommandAck;
  /** Dit id was al uitgevoerd; er is nu niets gewijzigd. */
  duplicate: boolean;
};

/** Zelfde vorm als de fout-ack van `runtime.runCommand`. */
export function failureAck(err: unknown): CommandAck {
  if (isCommandUserError(err)) {
    return { ok: false, error: err.code, code: err.code, params: err.params };
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

function storedAck(row: { ok: boolean; error: string | null }): CommandAck {
  return row.ok ? { ok: true } : { ok: false, error: row.error ?? "failed" };
}

function cleanId(commandId: string): string {
  const id = commandId.trim();
  if (!id) throw new Error("Cloud-commando zonder id");
  return id;
}

/**
 * Voert `execute` uit, tenzij dit cloud-id al uitgevoerd is. Het id wordt in dezelfde transactie
 * vastgelegd als wat `execute` wijzigt.
 *
 * Gooit `execute` een fout, dan is de transactie teruggedraaid en is er niets gewijzigd. Ook dat
 * wordt onthouden, zodat een latere levering het commando niet alsnog uitvoert (bv. een goal die
 * eerst geweigerd werd en minuten later toch zou verschijnen). De fout wordt daarna opnieuw gegooid.
 */
export async function runCloudCommandOnce(
  db: Db,
  commandId: string,
  execute: (tx: Tx) => Promise<CommandAck>,
): Promise<CloudCommandOutcome> {
  const id = cleanId(commandId);
  try {
    return await db.$transaction(async (tx) => {
      const prior = await tx.appliedCloudCommand.findUnique({ where: { id } });
      if (prior) return { ack: storedAck(prior), duplicate: true };
      const ack = await execute(tx);
      await tx.appliedCloudCommand.create({
        data: { id, ok: !!ack.ok, error: ack.ok ? null : (ack.error ?? null) },
      });
      return { ack, duplicate: false };
    }, TX_OPTIONS);
  } catch (err) {
    const ack = failureAck(err);
    try {
      await db.appliedCloudCommand.upsert({
        where: { id },
        create: { id, ok: false, error: ack.error ?? null },
        update: {},
      });
    } catch {
      /* Niet vastgelegd: er is niets gewijzigd, een nieuwe levering probeert het gewoon opnieuw. */
    }
    throw err;
  }
}

/** De cloud aanvaardde de bevestiging; vanaf nu mag de rij na `ACKED_RETENTION_MS` weg. */
export async function markCloudCommandAcked(
  db: Pick<PrismaClient, "appliedCloudCommand">,
  commandId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.appliedCloudCommand.updateMany({
    where: { id: cleanId(commandId), ackedAt: null },
    data: { ackedAt: now },
  });
}

/** Ruimt ids op die de cloud zeker niet meer levert. Geeft het aantal verwijderde rijen. */
export async function pruneAppliedCloudCommands(
  db: Pick<PrismaClient, "appliedCloudCommand">,
  now: Date = new Date(),
): Promise<number> {
  const res = await db.appliedCloudCommand.deleteMany({
    where: {
      OR: [
        { ackedAt: { lt: new Date(now.getTime() - ACKED_RETENTION_MS) } },
        { appliedAt: { lt: new Date(now.getTime() - UNACKED_RETENTION_MS) } },
      ],
    },
  });
  return res.count;
}
