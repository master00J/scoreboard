import type { Command } from "./validation/commands";
import type { SerializedDisplayState } from "./timer";
import type {
  SponsorLedgerPayload,
  SponsorTelemetryClipEnd,
  SponsorTelemetryClipStart,
} from "./sponsor-telemetry";

export type DisplayStatePayload = SerializedDisplayState;

export type TickPayload = {
  elapsed: number;
  running: boolean;
  startedAt: string | null;
  baseSec: number;
  serverNow: number;
};

export type CommandAck = {
  ok: boolean;
  error?: string;
  /** Niet-fataal; wordt als toast naar control gestuurd (bijv. overgeslagen wissel in de rij). */
  warning?: string;
  result?: unknown;
};

export type DesktopContext = {
  isElectron: true;
  appRoot: string;
  userDataDir: string;
  uploadsDir: string;
};

export type DesktopApiRequest = {
  method: string;
  path: string;
  search?: string;
  headers?: Record<string, string>;
  bodyText?: string;
};

export type DesktopApiResponse = {
  status: number;
  contentType: string;
  json?: unknown;
  text?: string;
};

export type ExportFormat = "json" | "html";

export type DesktopCaptureSourceInfo = {
  id: string;
  name: string;
  thumbnailDataUrl: string | null;
};

export type FolderPickResult = {
  canceled: boolean;
  folderPath: string | null;
  files: Array<{ name: string; path: string }>;
};

export type LicenseGetStatusResult =
  | { gate: false; organizationLabel: string | null; offlineGrace?: boolean }
  | {
      gate: true;
      machinePreview: string;
      message?: string;
      prefillLicenseKey?: string | null;
    };

export type LicenseActivateResult =
  | { ok: true; organizationLabel: string | null; status: "activated" | "already_activated" }
  | { ok: false; message: string; reason?: string };

export type MobileBridgeInfo = {
  enabled: boolean;
  port: number | null;
  pairingCode: string | null;
  operatorPin: string | null;
  bridgeUrls: string[];
  pairCodes: string[];
  operatorPinConfigured: boolean;
  cloud: {
    enabled: boolean;
    baseUrl: string | null;
    venueId: string | null;
    pairCode: string | null;
  };
};

export type ElectronBridge = {
  context: DesktopContext;
  selectFile: (opts: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
    multiSelections?: boolean;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  selectFolder: (opts: {
    title?: string;
    extensions?: string[];
  }) => Promise<FolderPickResult>;
  apiRequest: (req: DesktopApiRequest) => Promise<DesktopApiResponse>;
  sendCommand: (cmd: Command) => Promise<CommandAck>;
  getDisplaySnapshot: () => Promise<SerializedDisplayState | null>;
  onDisplayState: (listener: (state: SerializedDisplayState) => void) => () => void;
  onTick: (listener: (tick: TickPayload) => void) => () => void;
  onSponsorLedger: (listener: (ledger: SponsorLedgerPayload | null) => void) => () => void;
  onDisplayError: (listener: (payload: { message: string }) => void) => () => void;
  focusDisplayWindow: () => Promise<void>;
  reloadDisplayWindow: () => Promise<{ ok: boolean }>;
  exportMatch: (opts: {
    matchId: string;
    format: ExportFormat;
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  getDesktopCaptureSources: () => Promise<DesktopCaptureSourceInfo[]>;
  reportSponsorClipStart: (payload: SponsorTelemetryClipStart) => Promise<{ ok: boolean }>;
  reportSponsorClipEnd: (payload: SponsorTelemetryClipEnd) => Promise<{ ok: boolean }>;
  getSponsorLedgerSnapshot: () => Promise<SponsorLedgerPayload | null>;
  /** Huidige app-versie (package.json), voor update-melding. */
  getAppVersion: () => Promise<string>;
  /** Opent een https:-URL in de standaardbrowser (downloadpagina). */
  openExternalUrl: (url: string) => Promise<{ ok: boolean }>;
  /** ArenaCue-licentie: status (gate vs ok). */
  licenseGetStatus: () => Promise<LicenseGetStatusResult>;
  licenseActivate: (opts: { licenseKey: string }) => Promise<LicenseActivateResult>;
  getMobileBridgeInfo: () => Promise<MobileBridgeInfo>;
};
