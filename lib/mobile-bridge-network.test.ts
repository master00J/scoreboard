import { describe, expect, it } from "vitest";
import {
  bridgeAddresses,
  bridgeNetworkChoiceFromValue,
  bridgeNetworkOptionValue,
  initialBridgeNetworkChoice,
  isPrivateIpv4,
  listNetworkAdapters,
  normalizeBridgeNetworkChoice,
  resolveBridgeBind,
  type NetworkAdapter,
} from "./mobile-bridge-network";

const ethernet: NetworkAdapter = { name: "Ethernet", address: "192.168.1.20", netmask: "255.255.255.0", virtual: false };
const wifi: NetworkAdapter = { name: "Wi-Fi", address: "10.0.5.7", netmask: "255.255.0.0", virtual: false };
const hyperV: NetworkAdapter = { name: "vEthernet (Default Switch)", address: "172.20.16.1", netmask: "255.255.240.0", virtual: true };

describe("netwerkkaarten van de pc", () => {
  it("houdt alleen IPv4-kaarten met een echt adres over", () => {
    const adapters = listNetworkAdapters({
      Ethernet: [
        { address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", internal: false },
        { address: "192.168.1.20", netmask: "255.255.255.0", family: "IPv4", internal: false },
      ],
      "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true }],
      "Wi-Fi": [{ address: "169.254.10.3", netmask: "255.255.0.0", family: "IPv4", internal: false }],
      "vEthernet (Default Switch)": [{ address: "172.20.16.1", netmask: "255.255.240.0", family: 4, internal: false }],
    });
    expect(adapters).toEqual([ethernet, hyperV]);
  });

  it("herkent LAN-adressen", () => {
    for (const address of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "100.64.0.1"]) {
      expect(isPrivateIpv4(address)).toBe(true);
    }
    for (const address of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "192.169.0.1", "not-an-ip"]) {
      expect(isPrivateIpv4(address)).toBe(false);
    }
  });
});

describe("waar de bridge luistert", () => {
  it("luistert standaard op het netwerk van de standaardroute, niet op alle netwerken", () => {
    expect(resolveBridgeBind(null, [ethernet, wifi], "10.0.5.7")).toEqual({ host: "10.0.5.7", via: "auto", adapter: wifi });
    expect(resolveBridgeBind({ mode: "auto" }, [ethernet, wifi], "192.168.1.20").host).toBe("192.168.1.20");
  });

  it("volgt de standaardroute ook als die over een virtuele switch loopt (Hyper-V met externe switch)", () => {
    expect(resolveBridgeBind({ mode: "auto" }, [hyperV, ethernet], "172.20.16.1").host).toBe("172.20.16.1");
  });

  it("neemt zonder standaardroute (stadionnetwerk zonder internet) de eerste echte LAN-kaart", () => {
    expect(resolveBridgeBind({ mode: "auto" }, [hyperV, ethernet, wifi], null)).toEqual({
      host: "192.168.1.20",
      via: "auto",
      adapter: ethernet,
    });
  });

  it("luistert zonder netwerk alleen op deze pc", () => {
    expect(resolveBridgeBind({ mode: "auto" }, [], null)).toEqual({ host: "127.0.0.1", via: "none", adapter: null });
  });

  it("luistert alleen op alle netwerken als dat gekozen is", () => {
    expect(resolveBridgeBind({ mode: "all" }, [ethernet, wifi], "10.0.5.7")).toEqual({ host: "0.0.0.0", via: "all", adapter: null });
  });

  it("volgt de gekozen kaart, ook als DHCP haar een nieuw adres gaf", () => {
    const choice = { mode: "interface" as const, name: "Ethernet", address: "192.168.1.20" };
    expect(resolveBridgeBind(choice, [ethernet, wifi], "10.0.5.7")).toEqual({ host: "192.168.1.20", via: "choice", adapter: ethernet });
    const renewed = { ...ethernet, address: "192.168.1.77" };
    expect(resolveBridgeBind(choice, [renewed, wifi], "10.0.5.7").host).toBe("192.168.1.77");
  });

  it("herkent de gekozen kaart aan haar adres als Windows haar hernoemde", () => {
    const renamed = { ...ethernet, name: "Ethernet 2" };
    expect(resolveBridgeBind({ mode: "interface", name: "Ethernet", address: "192.168.1.20" }, [renamed, wifi], null).host).toBe(
      "192.168.1.20",
    );
  });

  it("valt terug op automatisch, niet op alle netwerken, als de gekozen kaart er niet is", () => {
    expect(resolveBridgeBind({ mode: "interface", name: "USB LAN", address: "192.168.50.2" }, [ethernet, wifi], "10.0.5.7")).toEqual({
      host: "10.0.5.7",
      via: "fallback",
      adapter: wifi,
    });
  });
});

describe("eerste start na de update", () => {
  it("een nieuwe installatie start automatisch", () => {
    expect(initialBridgeNetworkChoice([ethernet, wifi], "10.0.5.7", false)).toEqual({ mode: "auto" });
  });

  it("een gekoppelde pc met één netwerk gaat naar automatisch: de telefoon zit op dat netwerk", () => {
    expect(initialBridgeNetworkChoice([ethernet, hyperV], "192.168.1.20", true)).toEqual({ mode: "auto" });
  });

  it("een gekoppelde pc met meerdere netwerken start op één kaart en meldt welke", () => {
    expect(initialBridgeNetworkChoice([ethernet, wifi], "10.0.5.7", true)).toEqual({ mode: "auto", fromUpgrade: true });
  });
});

describe("keuze opslaan en tonen", () => {
  it("leest alleen geldige keuzes", () => {
    expect(normalizeBridgeNetworkChoice({ mode: "auto" })).toEqual({ mode: "auto" });
    expect(normalizeBridgeNetworkChoice({ mode: "all" })).toEqual({ mode: "all" });
    expect(normalizeBridgeNetworkChoice({ mode: "all", fromUpgrade: true })).toEqual({ mode: "auto", fromUpgrade: true });
    expect(normalizeBridgeNetworkChoice({ mode: "interface", name: "Ethernet", address: "192.168.1.20" })).toEqual({
      mode: "interface",
      name: "Ethernet",
      address: "192.168.1.20",
    });
    expect(normalizeBridgeNetworkChoice({ mode: "interface", name: "Ethernet", address: "999.1.1.1" })).toEqual({
      mode: "interface",
      name: "Ethernet",
      address: "",
    });
    for (const raw of [null, "auto", [], { mode: "everything" }, { mode: "interface", name: "", address: "" }]) {
      expect(normalizeBridgeNetworkChoice(raw)).toBeNull();
    }
  });

  it("zet een keuze om naar een waarde in de keuzelijst en terug", () => {
    for (const choice of [
      { mode: "auto" as const },
      { mode: "all" as const },
      { mode: "interface" as const, name: "Ethernet | 2 (stadion)", address: "192.168.1.20" },
    ]) {
      expect(bridgeNetworkChoiceFromValue(bridgeNetworkOptionValue(choice))).toEqual(choice);
    }
    expect(bridgeNetworkChoiceFromValue("interface:%E0%A4%A|1.2.3.4")).toBeNull();
    expect(bridgeNetworkChoiceFromValue("bogus")).toBeNull();
  });

  it("toont de telefoon alleen adressen waarop de bridge echt luistert", () => {
    expect(bridgeAddresses({ host: "192.168.1.20", via: "auto", adapter: ethernet }, [ethernet, wifi])).toEqual(["192.168.1.20"]);
    expect(bridgeAddresses({ host: "0.0.0.0", via: "all", adapter: null }, [hyperV, ethernet, wifi])).toEqual([
      "192.168.1.20",
      "10.0.5.7",
      "172.20.16.1",
    ]);
    expect(bridgeAddresses({ host: "0.0.0.0", via: "all", adapter: null }, [])).toEqual(["127.0.0.1"]);
  });
});
