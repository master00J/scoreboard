/**
 * Op welk netwerk de telefoonbediening (LAN-bridge) luistert. Dit is een keuze per pc (welke kabel,
 * welke wifi), net als de monitor van het stadionscherm, en staat dus naast de database, niet erin.
 *
 * - `auto` (standaard): het netwerk waarlangs deze pc naar buiten gaat, het LAN van het stadion.
 * - `interface`: een netwerkkaart die de club koos.
 * - `all`: alle netwerken (het oude gedrag), voor clubs die dat nodig hebben.
 */

export type BridgeNetworkChoice =
  | { mode: "auto"; fromUpgrade?: boolean }
  | { mode: "all" }
  | { mode: "interface"; name: string; address: string };

/** Een IPv4-netwerkkaart van deze pc. */
export type NetworkAdapter = {
  name: string;
  address: string;
  netmask: string;
  /** Docker, Hyper-V, VPN, …: zelden het stadionnetwerk. */
  virtual: boolean;
};

export type BridgeBind = {
  /** Adres waarop de bridge luistert. */
  host: string;
  /**
   * `auto` = netwerk van deze pc, `choice` = gekozen kaart, `fallback` = gekozen kaart niet
   * aangesloten (dan automatisch), `all` = alle netwerken, `none` = geen netwerk (alleen deze pc).
   */
  via: "auto" | "choice" | "fallback" | "all" | "none";
  adapter: NetworkAdapter | null;
};

export const ALL_INTERFACES = "0.0.0.0";
export const LOOPBACK = "127.0.0.1";

type OsNetworkEntry = { address: string; netmask: string; family: string | number; internal: boolean };

export function isLikelyVirtualAdapter(name: string): boolean {
  return /bluetooth|docker|hyper-v|loopback|npcap|tap|virtual|vmware|vethernet|wsl/i.test(name);
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(value: string): boolean {
  const m = IPV4.exec(value);
  return !!m && m.slice(1).every((part) => Number(part) <= 255);
}

/** 10/8, 172.16/12, 192.168/16 en 100.64/10 (gedeelde adresruimte, gsm-hotspots). */
export function isPrivateIpv4(address: string): boolean {
  const m = IPV4.exec(address);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** IPv4-kaarten uit `os.networkInterfaces()`, zonder loopback en zonder 169.254 (geen DHCP gekregen). */
export function listNetworkAdapters(nets: Record<string, OsNetworkEntry[] | undefined>): NetworkAdapter[] {
  const adapters: NetworkAdapter[] = [];
  for (const [name, entries] of Object.entries(nets)) {
    for (const net of entries ?? []) {
      const ipv4 = net.family === "IPv4" || net.family === 4;
      if (!ipv4 || net.internal || !isIpv4(net.address) || net.address.startsWith("169.254.")) continue;
      adapters.push({ name, address: net.address, netmask: net.netmask, virtual: isLikelyVirtualAdapter(name) });
    }
  }
  return adapters;
}

export function normalizeBridgeNetworkChoice(raw: unknown): BridgeNetworkChoice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if ((rec.mode === "all" || rec.mode === "auto") && rec.fromUpgrade === true) return { mode: "auto", fromUpgrade: true };
  if (rec.mode === "auto") return { mode: "auto" };
  if (rec.mode === "all") return { mode: "all" };
  if (rec.mode === "interface") {
    const name = typeof rec.name === "string" ? rec.name.slice(0, 200) : "";
    const address = typeof rec.address === "string" && isIpv4(rec.address) ? rec.address : "";
    if (!name && !address) return null;
    return { mode: "interface", name, address };
  }
  return null;
}

/** Het LAN van deze pc: de kaart van de standaardroute, anders de eerste echte kaart met een LAN-adres. */
function automaticAdapter(adapters: NetworkAdapter[], routeAddress: string | null): NetworkAdapter | null {
  const viaRoute = routeAddress ? adapters.find((a) => a.address === routeAddress) : undefined;
  return (
    viaRoute ??
    adapters.find((a) => !a.virtual && isPrivateIpv4(a.address)) ??
    adapters.find((a) => !a.virtual) ??
    adapters[0] ??
    null
  );
}

/**
 * Bepaalt waarop de bridge luistert. Een gekozen kaart wordt eerst op naam gezocht (DHCP kan haar
 * een ander adres geven), dan op adres. Is ze niet aangesloten, dan valt de bridge terug op het
 * automatische netwerk, nooit op alle netwerken.
 */
export function resolveBridgeBind(
  choice: BridgeNetworkChoice | null,
  adapters: NetworkAdapter[],
  routeAddress: string | null,
): BridgeBind {
  if (choice?.mode === "all") return { host: ALL_INTERFACES, via: "all", adapter: null };
  let via: BridgeBind["via"] = "auto";
  if (choice?.mode === "interface") {
    const byName = adapters.filter((a) => choice.name !== "" && a.name === choice.name);
    const picked =
      byName.find((a) => a.address === choice.address) ??
      byName[0] ??
      adapters.find((a) => choice.address !== "" && a.address === choice.address);
    if (picked) return { host: picked.address, via: "choice", adapter: picked };
    via = "fallback";
  }
  const adapter = automaticAdapter(adapters, routeAddress);
  if (!adapter) return { host: LOOPBACK, via: "none", adapter: null };
  return { host: adapter.address, via, adapter };
}

/**
 * Gebruik één netwerk bij een upgrade. Bij meerdere mogelijke kaarten toont het menu op welk
 * netwerk gekoppelde telefoons de bridge nu kunnen bereiken.
 */
export function initialBridgeNetworkChoice(
  adapters: NetworkAdapter[],
  routeAddress: string | null,
  bridgeUsedBefore: boolean,
): BridgeNetworkChoice {
  if (!bridgeUsedBefore) return { mode: "auto" };
  const candidates = new Set(adapters.filter((a) => !a.virtual || a.address === routeAddress).map((a) => a.address));
  return candidates.size > 1 ? { mode: "auto", fromUpgrade: true } : { mode: "auto" };
}

/** Adressen die de telefoon kan gebruiken: het gekozen adres, of bij alle netwerken elke kaart (echte eerst). */
export function bridgeAddresses(bind: BridgeBind, adapters: NetworkAdapter[]): string[] {
  if (bind.host !== ALL_INTERFACES) return [bind.host];
  const ordered = [...adapters.filter((a) => !a.virtual), ...adapters.filter((a) => a.virtual)].map((a) => a.address);
  return ordered.length > 0 ? [...new Set(ordered)] : [LOOPBACK];
}

/** Eén netwerk in de keuzelijst van het menu. */
export type BridgeNetworkOption = { name: string; address: string; virtual: boolean };

export type BridgeNetworkInfo = {
  /** Wat de club koos (`auto` als er nog niets gekozen is). */
  choice: BridgeNetworkChoice;
  /** Waarop de bridge nu luistert. */
  bind: BridgeBind;
  options: BridgeNetworkOption[];
};

/** Waarde van een keuze in de keuzelijst van het menu. */
export function bridgeNetworkOptionValue(choice: BridgeNetworkChoice): string {
  if (choice.mode === "interface") return `interface:${encodeURIComponent(choice.name)}|${choice.address}`;
  return choice.mode;
}

export function bridgeNetworkChoiceFromValue(value: string): BridgeNetworkChoice | null {
  if (value === "auto") return { mode: "auto" };
  if (value === "all") return { mode: "all" };
  if (!value.startsWith("interface:")) return null;
  const [rawName, address = ""] = value.slice("interface:".length).split("|");
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return null;
  }
  return normalizeBridgeNetworkChoice({ mode: "interface", name, address });
}

/** Wat het bedieningspaneel te zien krijgt. */
export type MobileBridgeNetworkState = BridgeNetworkInfo & {
  /** `MOBILE_BRIDGE_BIND` is gezet: kiezen in het menu kan dan niet. */
  fixedByEnv: boolean;
};
