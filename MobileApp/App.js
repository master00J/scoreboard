import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

const defaultBaseUrl = "http://192.168.1.10:17890";
const defaultPairingCode = "";
const defaultVenueId = "default";
const STORAGE_KEY = "scoreboard_mobile_session_v1";
const MATCH_STATUSES = ["SETUP", "PREMATCH", "FIRST_HALF", "HALF_TIME", "SECOND_HALF", "EXTRA_TIME", "FULL_TIME", "POST_MATCH"];

function fullName(player) {
  return `#${player.number} ${player.firstName} ${player.lastName}`;
}

function applyCustomerPairCode(raw) {
  const input = (raw ?? "").trim();
  if (!input.startsWith("ACPAIR:")) {
    throw new Error("Geen geldige ACPAIR-code.");
  }
  const payload = input.slice("ACPAIR:".length);
  const [rawBaseUrl, rawVenueId] = payload.split("|");
  const baseUrl = decodeURIComponent(String(rawBaseUrl ?? "")).trim();
  const venueId = decodeURIComponent(String(rawVenueId ?? "")).trim();
  if (!baseUrl || !venueId) {
    throw new Error("ACPAIR-code mist baseUrl of venueId.");
  }
  return { baseUrl, venueId };
}

async function callBridge(baseUrl, sessionToken, path, method = "GET", body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [connectionMode, setConnectionMode] = useState("cloud");
  const [venueId, setVenueId] = useState(defaultVenueId);
  const [pairingCode, setPairingCode] = useState(defaultPairingCode);
  const [customerPairCode, setCustomerPairCode] = useState("");
  const [operatorPin, setOperatorPin] = useState("");
  const [role, setRole] = useState("viewer");
  const [sessionToken, setSessionToken] = useState("");
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [status, setStatus] = useState("Nog niet verbonden");
  const [snapshot, setSnapshot] = useState(null);
  const [matches, setMatches] = useState([]);
  const [activeMatch, setActiveMatch] = useState(null);
  const [activeMatchDetails, setActiveMatchDetails] = useState(null);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [selectedCardPlayerId, setSelectedCardPlayerId] = useState(null);
  const [selectedCardColor, setSelectedCardColor] = useState("YELLOW");
  const [selectedGoalScorerId, setSelectedGoalScorerId] = useState(null);
  const [subOutId, setSubOutId] = useState(null);
  const [subInId, setSubInId] = useState(null);

  const canCall = useMemo(() => baseUrl.trim().length > 0 && sessionToken.trim().length > 0, [baseUrl, sessionToken]);
  const canMutate = role === "operator";
  const isCloud = connectionMode === "cloud";

  function cloudPath(path) {
    return path.startsWith("/api/") ? path : `/api${path}`;
  }

  async function pingHealth() {
    setStatus("Service pingen...");
    try {
      const url = isCloud ? `${baseUrl}${cloudPath("/control/state")}` : `${baseUrl}/mobile/health`;
      const res = await fetch(url, {
        headers: isCloud ? { Authorization: `Bearer ${sessionToken}` } : undefined,
      });
      setStatus(res.ok ? "Service online" : `Fout: ${res.status}`);
    } catch (error) {
      setStatus(`Niet bereikbaar: ${String(error)}`);
    }
  }

  async function loadSnapshot() {
    if (!canCall) return;
    try {
      const response = isCloud
        ? await callBridge(baseUrl, sessionToken, cloudPath("/control/state"))
        : await callBridge(baseUrl, sessionToken, "/mobile/snapshot");
      if (!response.ok) return setStatus(`Snapshot fout (${response.status})`);
      setSnapshot(isCloud ? response.data?.state ?? null : response.data);
    } catch (error) {
      setStatus(`Snapshot mislukt: ${String(error)}`);
    }
  }

  async function loadMatches() {
    if (!canCall) return;
    setLoadingMatches(true);
    try {
      const response = isCloud
        ? await callBridge(baseUrl, sessionToken, cloudPath("/control/state"))
        : await callBridge(baseUrl, sessionToken, "/mobile/api/matches");
      if (isCloud) {
        const cloudState = response.data?.state;
        if (cloudState?.matchId) {
          setMatches([{ id: cloudState.matchId, status: cloudState.mode ?? "UNKNOWN", homeScore: 0, awayScore: 0 }]);
          setStatus("Cloud state geladen");
        } else {
          setMatches([]);
          setStatus("Cloud state geladen (geen matchId)");
        }
        return;
      }
      if (!response.ok || !Array.isArray(response.data)) return setStatus(`Matches ophalen mislukt (${response.status})`);
      setMatches(response.data);
      setStatus(`Matches geladen (${response.data.length})`);
    } catch (error) {
      setStatus(`Matches fout: ${String(error)}`);
    } finally {
      setLoadingMatches(false);
    }
  }

  async function loadActiveMatchDetails(matchId) {
    if (isCloud) return;
    if (!canCall || !matchId) return setActiveMatchDetails(null);
    const response = await callBridge(baseUrl, sessionToken, `/mobile/api/matches/${matchId}`);
    if (response.ok && response.data?.id) {
      setActiveMatchDetails(response.data);
      if (!selectedTeamId) setSelectedTeamId(response.data.homeTeamId);
    }
  }

  async function sendCommand(command) {
    if (!canCall) return;
    if (!canMutate) return setStatus("Viewer-modus: commando's geblokkeerd.");
    setStatus(`Command ${command.type} verzenden...`);
    try {
      const response = isCloud
        ? await callBridge(baseUrl, sessionToken, cloudPath("/control/commands"), "POST", { command })
        : await callBridge(baseUrl, sessionToken, "/mobile/command", "POST", { command });
      if (!response.ok) return setStatus(`Command fout (${response.status})`);
      setStatus(isCloud ? "Command in cloud queue gezet." : `Command verwerkt: ${JSON.stringify(response.data)}`);
      await loadSnapshot();
    } catch (error) {
      setStatus(`Command mislukt: ${String(error)}`);
    }
  }

  async function authenticate() {
    setStatus("Authenticatie...");
    try {
      const res = await fetch(
        isCloud ? `${baseUrl}${cloudPath("/control/auth/session")}` : `${baseUrl}/mobile/auth/session`,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isCloud
            ? { venueId, role, pin: role === "operator" ? operatorPin : undefined }
            : { pairingCode, role, operatorPin: role === "operator" ? operatorPin : undefined },
        ),
      },
      );
      const payload = await res.json();
      const token = isCloud ? payload?.token : payload?.sessionToken;
      if (!res.ok || !token) return setStatus(payload?.error || payload?.message || `Login mislukt (${res.status})`);
      setSessionToken(token);
      setSessionExpiresAt(payload.expiresAt ?? null);
      setRole(payload.role === "operator" ? "operator" : "viewer");
      setStatus(`Verbonden als ${payload.role} (sessie tot ${payload.expiresAt})`);
    } catch (error) {
      setStatus(`Authenticatie fout: ${String(error)}`);
    }
  }

  function applyPairCodeFromInput() {
    try {
      const parsed = applyCustomerPairCode(customerPairCode);
      setConnectionMode("cloud");
      setBaseUrl(parsed.baseUrl);
      setVenueId(parsed.venueId);
      setStatus("Koppelcode toegepast. Kies rol en klik Koppel toestel.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw || !mounted) return;
        const parsed = JSON.parse(raw);
        if (parsed.baseUrl) setBaseUrl(parsed.baseUrl);
        if (parsed.connectionMode) setConnectionMode(parsed.connectionMode);
        if (parsed.venueId) setVenueId(parsed.venueId);
        if (parsed.pairingCode) setPairingCode(parsed.pairingCode);
        if (parsed.role) setRole(parsed.role);
        if (parsed.sessionToken) setSessionToken(parsed.sessionToken);
        if (parsed.sessionExpiresAt) setSessionExpiresAt(parsed.sessionExpiresAt);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ baseUrl, connectionMode, venueId, pairingCode, role, sessionToken, sessionExpiresAt }),
    );
  }, [baseUrl, connectionMode, venueId, pairingCode, role, sessionToken, sessionExpiresAt]);

  useEffect(() => {
    if (!sessionExpiresAt) return;
    const expMs = new Date(sessionExpiresAt).getTime();
    if (Number.isNaN(expMs)) return;
    if (Date.now() >= expMs) {
      setSessionToken("");
      setStatus("Sessie verlopen. Koppel toestel opnieuw.");
      return;
    }
    const t = setTimeout(() => {
      setSessionToken("");
      setStatus("Sessie verlopen. Koppel toestel opnieuw.");
    }, Math.max(1000, expMs - Date.now()));
    return () => clearTimeout(t);
  }, [sessionExpiresAt]);

  useEffect(() => {
    if (!canCall) return undefined;
    void loadSnapshot();
    void loadMatches();
    const t = setInterval(() => {
      void loadSnapshot();
      if (snapshot?.matchId) void loadActiveMatchDetails(snapshot.matchId);
    }, 2500);
    return () => clearInterval(t);
  }, [canCall, snapshot?.matchId]);

  useEffect(() => {
    if (snapshot?.matchId) void loadActiveMatchDetails(snapshot.matchId);
    else setActiveMatchDetails(null);
  }, [snapshot?.matchId]);

  const teamForActions =
    activeMatchDetails && selectedTeamId
      ? [activeMatchDetails.homeTeam, activeMatchDetails.awayTeam].find((t) => t.id === selectedTeamId) || activeMatchDetails.homeTeam
      : null;
  const playersForTeam = teamForActions?.players || [];
  const displayElapsed = snapshot?.timerBaseSec ?? 0;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>Stadium Scoreboard Mobile</Text>
        <Text style={styles.sub}>
          Companion app voor Android. Verbind via hetzelfde wifi-netwerk met de desktop-app.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Bridge URL</Text>
          <TextInput
            style={styles.input}
            value={baseUrl}
            onChangeText={setBaseUrl}
            autoCapitalize="none"
            placeholder="http://192.168.x.x:17890"
            placeholderTextColor="#666"
          />
          <Text style={styles.label}>Klant-koppelcode (aanbevolen)</Text>
          <TextInput
            style={styles.input}
            value={customerPairCode}
            onChangeText={setCustomerPairCode}
            autoCapitalize="none"
            placeholder="ACPAIR:..."
            placeholderTextColor="#666"
          />
          <Pressable style={styles.buttonSecondary} onPress={applyPairCodeFromInput}>
            <Text style={styles.buttonText}>Gebruik koppelcode</Text>
          </Pressable>
          <Text style={styles.label}>Connectiemodus</Text>
          <View style={styles.row}>
            <Pressable style={[styles.buttonSecondary, connectionMode === "cloud" ? styles.activeBorder : null]} onPress={() => setConnectionMode("cloud")}>
              <Text style={styles.buttonText}>Cloud (Optie A)</Text>
            </Pressable>
            <Pressable style={[styles.buttonSecondary, connectionMode === "local" ? styles.activeBorder : null]} onPress={() => setConnectionMode("local")}>
              <Text style={styles.buttonText}>Lokaal LAN</Text>
            </Pressable>
          </View>
          {isCloud && (
            <>
              <Text style={styles.label}>Venue ID</Text>
              <TextInput
                style={styles.input}
                value={venueId}
                onChangeText={setVenueId}
                autoCapitalize="none"
                placeholder="bv. genk-a"
                placeholderTextColor="#666"
              />
            </>
          )}
          <Text style={styles.label}>Rol</Text>
          <View style={styles.row}>
            <Pressable style={[styles.buttonSecondary, role === "viewer" ? styles.activeBorder : null]} onPress={() => setRole("viewer")}>
              <Text style={styles.buttonText}>Viewer</Text>
            </Pressable>
            <Pressable style={[styles.buttonSecondary, role === "operator" ? styles.activeBorder : null]} onPress={() => setRole("operator")}>
              <Text style={styles.buttonText}>Operator</Text>
            </Pressable>
          </View>
          {role === "operator" && (
            <>
              <Text style={styles.label}>Operator PIN</Text>
              <TextInput
                style={styles.input}
                value={operatorPin}
                onChangeText={setOperatorPin}
                autoCapitalize="none"
                secureTextEntry
                placeholder="PIN van desktop config"
                placeholderTextColor="#666"
              />
            </>
          )}
          {!isCloud && (
            <>
              <Text style={styles.label}>Pairing code (desktop boot.log)</Text>
              <TextInput
                style={styles.input}
                value={pairingCode}
                onChangeText={setPairingCode}
                autoCapitalize="none"
                placeholder="6-cijferige code"
                placeholderTextColor="#666"
              />
            </>
          )}
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={pingHealth}>
              <Text style={styles.buttonText}>Ping</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={authenticate}>
              <Text style={styles.buttonText}>Koppel toestel</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Snelle bediening</Text>
          {!canMutate && <Text style={styles.status}>Viewer-modus: commando's zijn geblokkeerd.</Text>}
          {!!activeMatchDetails && (
            <Text style={styles.status}>
              Score: {activeMatchDetails.homeTeam.name} {activeMatchDetails.homeScore} -{" "}
              {activeMatchDetails.awayScore} {activeMatchDetails.awayTeam.name}
            </Text>
          )}
          <View style={styles.row}>
            <Pressable
              style={styles.button}
              onPress={() =>
                sendCommand({ type: snapshot?.timerRunning ? "timer:pause" : "timer:start" })
              }
            >
              <Text style={styles.buttonText}>
                {snapshot?.timerRunning ? "Pauze timer" : "Start timer"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.button}
              onPress={() => sendCommand({ type: "timer:set", seconds: 0 })}
            >
              <Text style={styles.buttonText}>Reset timer</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            <Pressable
              style={styles.button}
              onPress={() => sendCommand({ type: "score:adjust", side: "home", delta: 1 })}
            >
              <Text style={styles.buttonText}>Home +1</Text>
            </Pressable>
            <Pressable
              style={styles.button}
              onPress={() => sendCommand({ type: "score:adjust", side: "away", delta: 1 })}
            >
              <Text style={styles.buttonText}>Away +1</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            <Pressable
              style={styles.buttonSecondary}
              onPress={() => sendCommand({ type: "score:adjust", side: "home", delta: -1 })}
            >
              <Text style={styles.buttonText}>Home -1</Text>
            </Pressable>
            <Pressable
              style={styles.buttonSecondary}
              onPress={() => sendCommand({ type: "score:adjust", side: "away", delta: -1 })}
            >
              <Text style={styles.buttonText}>Away -1</Text>
            </Pressable>
          </View>
          <Text style={styles.status}>Timer basis: {displayElapsed}s</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Matchstatus</Text>
          <View style={styles.grid}>
            {MATCH_STATUSES.map((statusItem) => (
              <Pressable
                key={statusItem}
                style={styles.smallButton}
                onPress={() => sendCommand({ type: "match:setStatus", status: statusItem })}
              >
                <Text style={styles.buttonTextSmall}>{statusItem}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Matchselectie</Text>
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={loadMatches}>
              <Text style={styles.buttonText}>
                {loadingMatches ? "Laden..." : "Herlaad matches"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.button}
              onPress={() =>
                activeMatch &&
                sendCommand({ type: "match:setActive", matchId: activeMatch.id })
              }
            >
              <Text style={styles.buttonText}>Activeer gekozen</Text>
            </Pressable>
          </View>
          {matches.slice(0, 10).map((m) => (
            <Pressable
              key={m.id}
              onPress={() => setActiveMatch(m)}
              style={[
                styles.matchItem,
                activeMatch?.id === m.id ? styles.matchItemActive : null,
              ]}
            >
              <Text style={styles.matchTitle}>
                {m.homeTeam?.name || "Home"} vs {m.awayTeam?.name || "Away"}
              </Text>
              <Text style={styles.matchSub}>
                {m.status} | {m.homeScore}-{m.awayScore}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Goals / kaarten / wissels</Text>
          {!activeMatchDetails ? (
            <Text style={styles.status}>Geen actieve match geselecteerd.</Text>
          ) : (
            <>
              <Text style={styles.subLabel}>Team voor acties</Text>
              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.buttonSecondary,
                    selectedTeamId === activeMatchDetails.homeTeamId ? styles.activeBorder : null,
                  ]}
                  onPress={() => setSelectedTeamId(activeMatchDetails.homeTeamId)}
                >
                  <Text style={styles.buttonText}>{activeMatchDetails.homeTeam.name}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.buttonSecondary,
                    selectedTeamId === activeMatchDetails.awayTeamId ? styles.activeBorder : null,
                  ]}
                  onPress={() => setSelectedTeamId(activeMatchDetails.awayTeamId)}
                >
                  <Text style={styles.buttonText}>{activeMatchDetails.awayTeam.name}</Text>
                </Pressable>
              </View>

              <Text style={styles.subLabel}>Goal scorer</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipsRow}>
                  {playersForTeam.slice(0, 25).map((player) => (
                    <Pressable
                      key={player.id}
                      style={[
                        styles.chip,
                        selectedGoalScorerId === player.id ? styles.activeBorder : null,
                      ]}
                      onPress={() => setSelectedGoalScorerId(player.id)}
                    >
                      <Text style={styles.chipText}>{fullName(player)}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.row}>
                <Pressable
                  style={styles.button}
                  onPress={() =>
                    sendCommand({
                      type: "goal:trigger",
                      side:
                        selectedTeamId === activeMatchDetails.homeTeamId ? "home" : "away",
                      scorerId: selectedGoalScorerId || undefined,
                    })
                  }
                >
                  <Text style={styles.buttonText}>Trigger goal</Text>
                </Pressable>
                <Pressable style={styles.buttonSecondary} onPress={() => sendCommand({ type: "goal:cancel" })}>
                  <Text style={styles.buttonText}>Annuleer goal</Text>
                </Pressable>
              </View>

              <Text style={styles.subLabel}>Kaart</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipsRow}>
                  {playersForTeam.slice(0, 25).map((player) => (
                    <Pressable
                      key={player.id}
                      style={[
                        styles.chip,
                        selectedCardPlayerId === player.id ? styles.activeBorder : null,
                      ]}
                      onPress={() => setSelectedCardPlayerId(player.id)}
                    >
                      <Text style={styles.chipText}>{fullName(player)}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.row}>
                <Pressable
                  style={[
                    styles.buttonSecondary,
                    selectedCardColor === "YELLOW" ? styles.activeBorder : null,
                  ]}
                  onPress={() => setSelectedCardColor("YELLOW")}
                >
                  <Text style={styles.buttonText}>Geel</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.buttonSecondary,
                    selectedCardColor === "RED" ? styles.activeBorder : null,
                  ]}
                  onPress={() => setSelectedCardColor("RED")}
                >
                  <Text style={styles.buttonText}>Rood</Text>
                </Pressable>
                <Pressable
                  style={styles.button}
                  onPress={() =>
                    selectedCardPlayerId &&
                    sendCommand({
                      type: "card:trigger",
                      teamId: selectedTeamId || activeMatchDetails.homeTeamId,
                      playerId: selectedCardPlayerId,
                      color: selectedCardColor,
                    })
                  }
                >
                  <Text style={styles.buttonText}>Geef kaart</Text>
                </Pressable>
              </View>

              <Text style={styles.subLabel}>Wissel</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipsRow}>
                  {playersForTeam.slice(0, 25).map((player) => (
                    <Pressable
                      key={`out-${player.id}`}
                      style={[styles.chip, subOutId === player.id ? styles.activeBorderWarn : null]}
                      onPress={() => setSubOutId(player.id)}
                    >
                      <Text style={styles.chipText}>OUT {fullName(player)}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipsRow}>
                  {playersForTeam.slice(0, 25).map((player) => (
                    <Pressable
                      key={`in-${player.id}`}
                      style={[styles.chip, subInId === player.id ? styles.activeBorder : null]}
                      onPress={() => setSubInId(player.id)}
                    >
                      <Text style={styles.chipText}>IN {fullName(player)}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <Pressable
                style={styles.button}
                onPress={() =>
                  subOutId &&
                  subInId &&
                  sendCommand({
                    type: "sub:trigger",
                    teamId: selectedTeamId || activeMatchDetails.homeTeamId,
                    playerOutId: subOutId,
                    playerInId: subInId,
                  })
                }
              >
                <Text style={styles.buttonText}>Trigger wissel</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.status}>{status}</Text>
          <Text style={styles.label}>Laatste snapshot</Text>
          <Text style={styles.snapshot}>
            {snapshot ? JSON.stringify(snapshot, null, 2) : "Nog geen data"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#09090b",
  },
  container: {
    padding: 16,
    gap: 14,
  },
  h1: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
  },
  sub: {
    color: "#a1a1aa",
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#121216",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#27272a",
    gap: 8,
  },
  label: {
    color: "#e4e4e7",
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 8,
    color: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#0f0f12",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flex: 1,
    alignItems: "center",
  },
  buttonSecondary: {
    backgroundColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flex: 1,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  buttonTextSmall: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 11,
  },
  smallButton: {
    backgroundColor: "#1d4ed8",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  status: {
    color: "#93c5fd",
  },
  subLabel: {
    color: "#cbd5e1",
    fontSize: 12,
    marginTop: 4,
  },
  snapshot: {
    color: "#c4b5fd",
    fontSize: 12,
    fontFamily: "monospace",
  },
  matchItem: {
    borderWidth: 1,
    borderColor: "#3f3f46",
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    backgroundColor: "#0f0f12",
  },
  matchItemActive: {
    borderColor: "#60a5fa",
  },
  matchTitle: {
    color: "#fff",
    fontWeight: "600",
  },
  matchSub: {
    color: "#94a3b8",
    marginTop: 2,
    fontSize: 12,
  },
  chipsRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 20,
    backgroundColor: "#0f172a",
  },
  chipText: {
    color: "#e2e8f0",
    fontSize: 12,
  },
  activeBorder: {
    borderColor: "#60a5fa",
    borderWidth: 2,
  },
  activeBorderWarn: {
    borderColor: "#f59e0b",
    borderWidth: 2,
  },
});
