import { app } from "electron";
import { readStoredLicense } from "./license-service";

type CloudRuntime = {
  getDisplaySnapshot: () => Promise<unknown>;
  runCommand: (command: unknown) => Promise<unknown>;
};

type CloudAgentOptions = {
  runtime: CloudRuntime;
  log: (line: string) => void;
};

type PendingCommand = {
  id: string;
  command: unknown;
};

export type CloudAgentHandle = {
  stop: () => void;
};

export function startCloudControlAgent(options: CloudAgentOptions): CloudAgentHandle | null {
  const stored = readStoredLicense(app.getPath("userData"));
  const baseUrl = (
    process.env.CONTROL_CLOUD_BASE_URL?.trim() ||
    stored?.controlCloudBaseUrl ||
    ""
  ).replace(/\/$/, "");
  const desktopKey = process.env.CONTROL_DESKTOP_KEY?.trim() || stored?.controlDesktopKey;
  const venueId = process.env.CONTROL_VENUE_ID?.trim() || stored?.controlVenueId;
  if (!baseUrl || !desktopKey || !venueId) {
    options.log("[cloud-control] uitgeschakeld (CONTROL_CLOUD_BASE_URL/CONTROL_DESKTOP_KEY/CONTROL_VENUE_ID ontbreekt).");
    return null;
  }

  const customerPairCode = `ACPAIR:${encodeURIComponent(baseUrl)}|${encodeURIComponent(venueId)}`;

  let disposed = false;
  let busy = false;

  async function postState() {
    const state = await options.runtime.getDisplaySnapshot();
    await fetch(`${baseUrl}/api/control/desktop/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-desktop-key": desktopKey,
      },
      body: JSON.stringify({ venueId, state }),
    });
  }

  async function pullCommands(): Promise<PendingCommand[]> {
    const res = await fetch(
      `${baseUrl}/api/control/desktop/commands?venueId=${encodeURIComponent(venueId)}`,
      {
        headers: { "x-desktop-key": desktopKey },
      },
    );
    if (!res.ok) return [];
    const payload = (await res.json()) as { commands?: PendingCommand[] };
    return Array.isArray(payload.commands) ? payload.commands : [];
  }

  async function ackCommand(commandId: string, result: { ok: boolean; error?: string; result?: unknown }) {
    await fetch(`${baseUrl}/api/control/desktop/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-desktop-key": desktopKey,
      },
      body: JSON.stringify({
        commandId,
        ok: result.ok,
        error: result.error,
        result: result.result ?? null,
      }),
    });
  }

  async function tick() {
    if (disposed || busy) return;
    busy = true;
    try {
      await postState();
      const commands = await pullCommands();
      for (const item of commands) {
        try {
          const runResult = (await options.runtime.runCommand(item.command)) as {
            ok?: boolean;
            error?: string;
            result?: unknown;
          };
          await ackCommand(item.id, {
            ok: !!runResult?.ok,
            error: runResult?.error,
            result: runResult?.result,
          });
        } catch (err) {
          await ackCommand(item.id, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      options.log(`[cloud-control] sync fout: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      busy = false;
    }
  }

  const interval = setInterval(() => {
    void tick();
  }, 1500);
  void tick();
  options.log(`[cloud-control] actief voor venue=${venueId}`);
  options.log(`[cloud-control] klant-koppelcode: ${customerPairCode}`);

  return {
    stop: () => {
      disposed = true;
      clearInterval(interval);
    },
  };
}
