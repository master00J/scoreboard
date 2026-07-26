import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { DisplayScreen } from "./screens/DisplayScreen";
import { MediaScreen } from "./screens/MediaScreen";
import { SetupScreen } from "./screens/SetupScreen";

const defaultBaseUrl = "http://192.168.1.10:17890";
const defaultPairingCode = "";
const defaultVenueId = "default";
const STORAGE_KEY = "scoreboard_mobile_session_v1";
const MATCH_STATUSES = ["SETUP", "PREMATCH", "FIRST_HALF", "HALF_TIME", "SECOND_HALF", "EXTRA_TIME", "FULL_TIME", "POST_MATCH"];
const ARENACUE_LOGO_URI = "https://arenacue.be/assets/arenacue-icon.png";

function fullName(player) {
  return `#${player.number} ${player.firstName} ${player.lastName}`;
}

function computeElapsedSeconds(snapshot, nowMs = Date.now()) {
  if (!snapshot) return 0;
  if (typeof snapshot.timerElapsedSec === "number") {
    const receivedAtMs = Number(snapshot._receivedAtMs ?? nowMs);
    const liveDeltaSec = snapshot.timerRunning ? (nowMs - receivedAtMs) / 1000 : 0;
    return Math.max(0, Math.floor(snapshot.timerElapsedSec + liveDeltaSec));
  }
  const baseSec = Number(snapshot.timerBaseSec ?? 0);
  if (!snapshot.timerRunning || !snapshot.timerStartedAt) return Math.max(0, Math.floor(baseSec));
  const receivedAtMs = Number(snapshot._receivedAtMs ?? nowMs);
  return Math.max(0, Math.floor(baseSec + (nowMs - receivedAtMs) / 1000));
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function normalizeCloudBaseUrl(rawBaseUrl) {
  const normalized = String(rawBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\/(www\.)?arenacue\.com$/i.test(normalized)) {
    return "https://arenacue.be";
  }
  return normalized;
}

function parsePairCode(raw) {
  const input = (raw ?? "").trim();
  if (!input.startsWith("ACPAIR:")) {
    throw new Error("Geen geldige ACPAIR-code.");
  }
  const payload = input.slice("ACPAIR:".length);
  const parts = payload.split("|");
  if (parts[0] === "local") {
    const baseUrl = decodeURIComponent(String(parts[1] ?? "")).trim();
    const pairingCode = decodeURIComponent(String(parts[2] ?? "")).trim();
    const operatorPin = decodeURIComponent(String(parts[3] ?? "")).trim();
    if (!baseUrl || !pairingCode) {
      throw new Error("LAN-koppelcode mist Bridge URL of pairing-code.");
    }
    return {
      connectionMode: "local",
      baseUrl,
      pairingCode,
      operatorPin,
      role: operatorPin ? "operator" : "viewer",
    };
  }
  if (parts[0] === "cloud") {
    const baseUrl = normalizeCloudBaseUrl(decodeURIComponent(String(parts[1] ?? "")));
    const venueId = decodeURIComponent(String(parts[2] ?? "")).trim();
    const cloudPairToken = decodeURIComponent(String(parts[3] ?? "")).trim();
    if (!baseUrl || !venueId) {
      throw new Error("Cloud-koppelcode mist baseUrl of venueId.");
    }
    return { connectionMode: "cloud", baseUrl, venueId, cloudPairToken, role: cloudPairToken ? "operator" : "viewer" };
  }
  const [rawBaseUrl, rawVenueId] = parts;
  const baseUrl = normalizeCloudBaseUrl(decodeURIComponent(String(rawBaseUrl ?? "")));
  const venueId = decodeURIComponent(String(rawVenueId ?? "")).trim();
  if (!baseUrl || !venueId) {
    throw new Error("ACPAIR-code mist baseUrl of venueId.");
  }
  return { connectionMode: "cloud", baseUrl, venueId };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const receivedAtMs = Date.now();
  if (typeof snapshot.timerElapsedSec === "number") {
    return { ...snapshot, _receivedAtMs: receivedAtMs };
  }
  const baseSec = Number(snapshot.timerBaseSec ?? 0);
  if (!snapshot.timerRunning || !snapshot.timerStartedAt) {
    return { ...snapshot, timerElapsedSec: Math.max(0, Math.floor(baseSec)), _receivedAtMs: receivedAtMs };
  }
  const startedMs = new Date(snapshot.timerStartedAt).getTime();
  const updatedMs = new Date(snapshot.updatedAt ?? "").getTime();
  const anchorMs = Number.isFinite(updatedMs) ? updatedMs : startedMs;
  const elapsedSec =
    Number.isFinite(startedMs) && Number.isFinite(anchorMs)
      ? Math.max(0, Math.floor(baseSec + (anchorMs - startedMs) / 1000))
      : Math.max(0, Math.floor(baseSec));
  return { ...snapshot, timerElapsedSec: elapsedSec, _receivedAtMs: receivedAtMs };
}

function readCloudState(payload) {
  if (!payload || typeof payload !== "object") return null;
  if ("state" in payload) return payload.state;
  if ("displayState" in payload) return payload.displayState;
  return payload;
}

function extractMatchId(state) {
  if (!state || typeof state !== "object") return null;
  return state.matchId ?? state.activeMatchId ?? state.activeMatch?.id ?? state.match?.id ?? null;
}

function summarizeMatch(match) {
  if (!match || typeof match !== "object" || !match.id) return null;
  return {
    id: match.id,
    status: match.status ?? "UNKNOWN",
    homeScore: Number(match.homeScore ?? 0),
    awayScore: Number(match.awayScore ?? 0),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
}

function cloudMatchesFromState(state) {
  if (!state || typeof state !== "object") return [];
  const byId = new Map();
  const addMatch = (match) => {
    const summary = summarizeMatch(match);
    if (summary) byId.set(summary.id, summary);
  };
  if (Array.isArray(state.matches)) {
    state.matches.forEach(addMatch);
  }
  addMatch(state.activeMatch);
  addMatch(state.match);
  const matchId = extractMatchId(state);
  if (matchId && !byId.has(matchId)) {
    byId.set(matchId, {
      id: matchId,
      status: state.matchStatus ?? state.status ?? state.mode ?? "ACTIVE",
      homeScore: Number(state.homeScore ?? 0),
      awayScore: Number(state.awayScore ?? 0),
    });
  }
  return Array.from(byId.values());
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
  const [cloudPairToken, setCloudPairToken] = useState("");
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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [nowMs, setNowMs] = useState(Date.now());
  const [preparedGoalSide, setPreparedGoalSide] = useState(null);
  const [activeTab, setActiveTab] = useState("operator");
  const [menuOpen, setMenuOpen] = useState(false);
  const [goalPickerSide, setGoalPickerSide] = useState(null);

  const canCall = useMemo(() => baseUrl.trim().length > 0 && sessionToken.trim().length > 0, [baseUrl, sessionToken]);
  const canMutate = role === "operator";
  const isCloud = connectionMode === "cloud";

  function cloudPath(path) {
    return path.startsWith("/api/") ? path : `/api${path}`;
  }

  function syncCloudMatchData(cloudState) {
    const nextMatches = cloudMatchesFromState(cloudState);
    setMatches(nextMatches);

    const matchId = extractMatchId(cloudState);
    const activeFromState = cloudState?.activeMatch ?? cloudState?.match ?? null;
    if (activeFromState?.id) {
      setActiveMatchDetails(activeFromState);
      setActiveMatch(summarizeMatch(activeFromState));
      setSelectedTeamId((current) =>
        current === activeFromState.homeTeamId || current === activeFromState.awayTeamId
          ? current
          : activeFromState.homeTeamId,
      );
      return;
    }

    if (matchId) {
      const activeSummary = nextMatches.find((match) => match.id === matchId) ?? {
        id: matchId,
        status: cloudState?.mode ?? "ACTIVE",
        homeScore: Number(cloudState?.homeScore ?? 0),
        awayScore: Number(cloudState?.awayScore ?? 0),
      };
      setActiveMatch(activeSummary);
      return;
    }

    setActiveMatch(null);
    setActiveMatchDetails(null);
  }

  function resetSessionForConnectionChange() {
    setSessionToken("");
    setSessionExpiresAt(null);
    setSnapshot(null);
    setMatches([]);
    setActiveMatch(null);
    setActiveMatchDetails(null);
  }

  function formatAuthStatus(payload) {
    const roleText = payload.role === "operator" ? "operator" : "viewer";
    return payload.expiresAt
      ? `Verbonden als ${roleText} (sessie tot ${payload.expiresAt})`
      : `Verbonden als ${roleText}`;
  }

  async function loadSnapshotWithToken(token) {
    if (!baseUrl.trim() || !token?.trim()) return null;
    try {
      const response = isCloud
        ? await callBridge(baseUrl, token, cloudPath("/control/state"))
        : await callBridge(baseUrl, token, "/mobile/snapshot");
      if (!response.ok) {
        const message = response.data?.message || response.data?.error || `Snapshot fout (${response.status})`;
        setStatus(message);
        return null;
      }
      const cloudState = isCloud ? readCloudState(response.data) : null;
      const nextSnapshot = normalizeSnapshot(isCloud ? cloudState : response.data);
      setSnapshot(nextSnapshot);
      if (isCloud) {
        syncCloudMatchData(cloudState);
        if (!cloudState) {
          setStatus("Cloud login ok, maar desktop stuurt nog geen live state voor deze Venue ID.");
        }
      }
      return nextSnapshot;
    } catch (error) {
      setStatus(`Snapshot mislukt: ${String(error)}`);
      return null;
    }
  }

  async function loadMatchesWithToken(token) {
    if (!baseUrl.trim() || !token?.trim()) return;
    setLoadingMatches(true);
    try {
      const response = isCloud
        ? await callBridge(baseUrl, token, cloudPath("/control/state"))
        : await callBridge(baseUrl, token, "/mobile/api/matches");
      if (isCloud) {
        if (!response.ok) {
          const message = response.data?.message || response.data?.error || `Cloud state ophalen mislukt (${response.status})`;
          setStatus(message);
          return;
        }
        const cloudState = readCloudState(response.data);
        const nextMatches = cloudMatchesFromState(cloudState);
        syncCloudMatchData(cloudState);
        if (nextMatches.length > 0) {
          setStatus(`Cloud matches geladen (${nextMatches.length})`);
        } else if (cloudState) {
          setStatus("Cloud verbonden, maar er is nog geen actieve match of matchlijst.");
        } else {
          setStatus("Cloud login ok, maar desktop stuurt nog geen live state voor deze Venue ID.");
        }
        return;
      }
      if (!response.ok || !Array.isArray(response.data)) {
        const message = response.data?.message || response.data?.error || `Matches ophalen mislukt (${response.status})`;
        setStatus(message);
        return;
      }
      setMatches(response.data);
      setStatus(`Matches geladen (${response.data.length})`);
    } catch (error) {
      setStatus(`Matches fout: ${String(error)}`);
    } finally {
      setLoadingMatches(false);
    }
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
    if (!canCall) return null;
    return loadSnapshotWithToken(sessionToken);
  }

  async function loadMatches() {
    if (!canCall) return;
    return loadMatchesWithToken(sessionToken);
  }

  async function loadActiveMatchDetails(matchId) {
    if (isCloud) {
      const cloudMatch = snapshot?.activeMatch ?? snapshot?.match ?? null;
      if (cloudMatch?.id === matchId) {
        setActiveMatchDetails(cloudMatch);
        if (!selectedTeamId) setSelectedTeamId(cloudMatch.homeTeamId);
      }
      return;
    }
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
      const nextSnapshot = await loadSnapshot();
      await loadMatches();
      const nextMatchId = extractMatchId(nextSnapshot);
      if (nextMatchId) await loadActiveMatchDetails(nextMatchId);
    } catch (error) {
      setStatus(`Command mislukt: ${String(error)}`);
    }
  }

  async function prepareGoal(side) {
    setPreparedGoalSide(side);
    await sendCommand({ type: "goal:prepare", side });
  }

  async function confirmGoal() {
    if (!activeMatchDetails) return;
    const side = selectedTeamId === activeMatchDetails.homeTeamId ? "home" : "away";
    if (preparedGoalSide !== side) {
      await prepareGoal(side);
    }
    await sendCommand({
      type: "goal:trigger",
      side,
      scorerId: selectedGoalScorerId || undefined,
    });
    setPreparedGoalSide(null);
  }

  async function triggerGoalForSide(side) {
    await sendCommand({ type: "goal:trigger", side });
    setPreparedGoalSide(null);
  }

  function closeGoalPicker() {
    setGoalPickerSide(null);
    setSelectedGoalScorerId(null);
  }

  async function cancelGoalPicker() {
    await sendCommand({ type: "goal:cancel" });
    setPreparedGoalSide(null);
    closeGoalPicker();
  }

  async function confirmGoalFromPicker(scorerId) {
    if (!goalPickerSide) return;
    await sendCommand({
      type: "goal:trigger",
      side: goalPickerSide,
      scorerId: scorerId || undefined,
    });
    setPreparedGoalSide(null);
    closeGoalPicker();
  }

  async function handleQuickGoal(side) {
    const details = activeMatchDetails;
    const team =
      details && side === "away"
        ? details.awayTeam
        : details?.homeTeam;
    if (details && team?.players?.length > 0) {
      setSelectedTeamId(team.id);
      setSelectedGoalScorerId(null);
      setGoalPickerSide(side);
      await prepareGoal(side);
      setStatus(`Goalvisual gestart voor ${team.name}. Kies de scorer in de pop-up.`);
      return;
    }
    await triggerGoalForSide(side);
  }

  async function authenticate() {
    setStatus("Authenticatie...");
    try {
      if (isCloud && role === "viewer" && !cloudPairToken.trim()) {
        setStatus("Viewer-login via cloud vereist een geldige pair token uit de desktop QR.");
        return;
      }
      const res = await fetch(
        isCloud ? `${baseUrl}${cloudPath("/control/auth/session")}` : `${baseUrl}/mobile/auth/session`,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isCloud
            ? { venueId, role, pin: role === "operator" ? operatorPin : undefined, pairToken: cloudPairToken || undefined }
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
      setStatus(`${formatAuthStatus(payload)}. Data laden...`);
      const nextSnapshot = await loadSnapshotWithToken(token);
      await loadMatchesWithToken(token);
      const nextMatchId = extractMatchId(nextSnapshot);
      if (nextMatchId) await loadActiveMatchDetails(nextMatchId);
    } catch (error) {
      setStatus(`Authenticatie fout: ${String(error)}`);
    }
  }

  function applyPairCode(raw) {
    try {
      const parsed = parsePairCode(raw);
      setConnectionMode(parsed.connectionMode);
      setBaseUrl(parsed.baseUrl);
      setSessionToken("");
      setSessionExpiresAt(null);
      if (parsed.venueId) setVenueId(parsed.venueId);
      setCloudPairToken(parsed.cloudPairToken ?? "");
      setPairingCode(parsed.pairingCode ?? "");
      setOperatorPin(parsed.operatorPin ?? "");
      setRole(parsed.role ?? "viewer");
      setStatus(
        parsed.connectionMode === "local"
          ? "LAN QR toegepast. Klik Koppel toestel."
          : parsed.cloudPairToken
            ? "Cloud QR toegepast. Klik Koppel toestel."
            : "Cloud-koppelcode toegepast. Kies rol en klik Koppel toestel.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function applyPairCodeFromInput() {
    applyPairCode(customerPairCode);
  }

  async function openQrScanner() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setStatus("Camera-toegang geweigerd. Gebruik de QR-code tekst handmatig.");
        return;
      }
    }
    setHasScanned(false);
    setScannerOpen(true);
  }

  function handleBarcodeScanned(result) {
    if (hasScanned) return;
    const data = String(result?.data ?? "");
    setHasScanned(true);
    setScannerOpen(false);
    setCustomerPairCode(data);
    applyPairCode(data);
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
        if (parsed.cloudPairToken) setCloudPairToken(parsed.cloudPairToken);
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
      JSON.stringify({ baseUrl, connectionMode, venueId, pairingCode, cloudPairToken, role, sessionToken, sessionExpiresAt }),
    );
  }, [baseUrl, connectionMode, venueId, pairingCode, cloudPairToken, role, sessionToken, sessionExpiresAt]);

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
      const matchId = extractMatchId(snapshot);
      if (matchId) void loadActiveMatchDetails(matchId);
    }, 2500);
    return () => clearInterval(t);
  }, [canCall, extractMatchId(snapshot)]);

  useEffect(() => {
    const matchId = extractMatchId(snapshot);
    if (matchId) void loadActiveMatchDetails(matchId);
    else setActiveMatchDetails(null);
  }, [extractMatchId(snapshot)]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const teamForActions =
    activeMatchDetails
      ? [activeMatchDetails.homeTeam, activeMatchDetails.awayTeam].find((t) => t.id === selectedTeamId) || activeMatchDetails.homeTeam
      : null;
  const playersForTeam = teamForActions?.players || [];
  const displayElapsed = computeElapsedSeconds(snapshot, nowMs);
  const activeTeamSide = activeMatchDetails && selectedTeamId === activeMatchDetails.awayTeamId ? "away" : "home";
  const homeLabel = activeMatchDetails?.homeTeam?.name || activeMatch?.homeTeam?.name || "HOME";
  const awayLabel = activeMatchDetails?.awayTeam?.name || activeMatch?.awayTeam?.name || "AWAY";
  const homeScore = Number(activeMatchDetails?.homeScore ?? activeMatch?.homeScore ?? snapshot?.homeScore ?? 0);
  const awayScore = Number(activeMatchDetails?.awayScore ?? activeMatch?.awayScore ?? snapshot?.awayScore ?? 0);
  const connectionText = canCall ? `Verbonden als ${role}` : "Niet gekoppeld";
  const goalPickerTeam =
    goalPickerSide && activeMatchDetails
      ? goalPickerSide === "away"
        ? activeMatchDetails.awayTeam
        : activeMatchDetails.homeTeam
      : null;
  const goalPickerPlayers = goalPickerTeam?.players || [];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.remoteHeader}>
          <Pressable style={styles.headerIconButton} onPress={() => setMenuOpen((open) => !open)}>
            <Text style={styles.headerIconText}>☰</Text>
          </Pressable>
          <View style={styles.brandCenter}>
            <Image source={{ uri: ARENACUE_LOGO_URI }} style={styles.brandLogo} resizeMode="contain" />
            <View>
              <Text style={styles.brandArena}>ArenaCue</Text>
              <Text style={styles.brandControl}>Control</Text>
            </View>
          </View>
          <Pressable
            style={styles.headerIconButton}
            onPress={() => {
              setActiveTab("settings");
              setMenuOpen(false);
            }}
          >
            <Text style={styles.headerIconText}>⚙</Text>
          </Pressable>
        </View>

        {menuOpen && (
          <View style={styles.menuCard}>
            <Pressable
              style={[styles.menuButton, activeTab === "operator" ? styles.menuButtonActive : null]}
              onPress={() => {
                setActiveTab("operator");
                setMenuOpen(false);
              }}
            >
              <Text style={styles.menuButtonText}>Wedstrijdbeheer</Text>
            </Pressable>
            <Pressable
              style={[styles.menuButton, activeTab === "setup" ? styles.menuButtonActive : null]}
              onPress={() => {
                setActiveTab("setup");
                setMenuOpen(false);
              }}
            >
              <Text style={styles.menuButtonText}>Setup</Text>
            </Pressable>
            <Pressable
              style={[styles.menuButton, activeTab === "media" ? styles.menuButtonActive : null]}
              onPress={() => {
                setActiveTab("media");
                setMenuOpen(false);
              }}
            >
              <Text style={styles.menuButtonText}>Media</Text>
            </Pressable>
            <Pressable
              style={[styles.menuButton, activeTab === "display" ? styles.menuButtonActive : null]}
              onPress={() => {
                setActiveTab("display");
                setMenuOpen(false);
              }}
            >
              <Text style={styles.menuButtonText}>Display</Text>
            </Pressable>
            <Pressable
              style={[styles.menuButton, activeTab === "settings" ? styles.menuButtonActive : null]}
              onPress={() => {
                setActiveTab("settings");
                setMenuOpen(false);
              }}
            >
              <Text style={styles.menuButtonText}>Koppeling</Text>
            </Pressable>
            <Pressable
              style={styles.menuButton}
              onPress={() => {
                setMenuOpen(false);
                void loadSnapshot();
                void loadMatches();
              }}
            >
              <Text style={styles.menuButtonText}>Herlaad data</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.connectionPill}>
          <View style={[styles.connectionDot, canCall ? styles.connectionDotOnline : styles.connectionDotOffline]} />
          <Text style={styles.connectionPillText}>{connectionText}</Text>
          <Text style={styles.connectionPillSub}>{isCloud ? "Cloud" : "Lokaal LAN"}</Text>
        </View>

        <View style={styles.remotePanel}>
          <View style={styles.remoteTimerCard}>
            <Text style={styles.remoteTimerValue}>{formatClock(displayElapsed)}</Text>
            <Text style={styles.remoteTimerState}>{snapshot?.timerRunning ? "Timer loopt" : "Timer gepauzeerd"}</Text>
          </View>

          <View style={styles.remoteScoreCard}>
            <View style={styles.scoreSide}>
              <Text style={styles.scoreLabel}>{homeLabel}</Text>
              <Text style={styles.scoreNumber}>{Number.isFinite(homeScore) ? homeScore : 0}</Text>
            </View>
            <Text style={styles.scoreDash}>-</Text>
            <View style={styles.scoreSide}>
              <Text style={styles.scoreLabel}>{awayLabel}</Text>
              <Text style={styles.scoreNumber}>{Number.isFinite(awayScore) ? awayScore : 0}</Text>
            </View>
          </View>

          <View style={styles.remoteButtonRow}>
            <Pressable style={styles.remoteActionButton} onPress={() => handleQuickGoal("home")}>
              <Text style={styles.remoteActionMain}>+1</Text>
              <Text style={styles.remoteActionSub}>HOME</Text>
            </Pressable>
            <Pressable style={styles.remoteGhostButton} onPress={() => sendCommand({ type: "timer:set", seconds: 0 })}>
              <Text style={styles.remoteIcon}>⟳</Text>
            </Pressable>
            <Pressable style={styles.remoteActionButton} onPress={() => handleQuickGoal("away")}>
              <Text style={styles.remoteActionMain}>+1</Text>
              <Text style={styles.remoteActionSub}>AWAY</Text>
            </Pressable>
          </View>

          <View style={styles.remoteButtonRow}>
            <Pressable style={styles.remoteDarkButton} onPress={() => sendCommand({ type: "score:adjust", side: "home", delta: -1 })}>
              <Text style={styles.remoteActionMain}>−</Text>
              <Text style={styles.remoteActionSub}>HOME</Text>
            </Pressable>
            <Pressable
              style={styles.remotePlayButton}
              onPress={() => sendCommand({ type: snapshot?.timerRunning ? "timer:pause" : "timer:start" })}
            >
              <Text style={styles.remotePlayIcon}>{snapshot?.timerRunning ? "Ⅱ" : "▶"}</Text>
            </Pressable>
            <Pressable style={styles.remoteDarkButton} onPress={() => sendCommand({ type: "score:adjust", side: "away", delta: -1 })}>
              <Text style={styles.remoteActionMain}>−</Text>
              <Text style={styles.remoteActionSub}>AWAY</Text>
            </Pressable>
          </View>
        </View>

        <Modal
          visible={!!goalPickerSide && !!goalPickerTeam}
          transparent
          animationType="fade"
          onRequestClose={() => void cancelGoalPicker()}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Kies doelpuntenmaker</Text>
                <Text style={styles.modalSubtitle}>{goalPickerTeam?.name}</Text>
              </View>
              <ScrollView style={styles.modalPlayerList} contentContainerStyle={styles.modalPlayerGrid}>
                {goalPickerPlayers.map((player) => (
                  <Pressable
                    key={player.id}
                    style={[
                      styles.modalPlayerButton,
                      selectedGoalScorerId === player.id ? styles.modalPlayerButtonActive : null,
                    ]}
                    onPress={() => setSelectedGoalScorerId(player.id)}
                  >
                    <Text style={styles.modalPlayerNumber}>#{player.number}</Text>
                    <Text style={styles.modalPlayerName}>
                      {player.firstName} {player.lastName}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.modalFooter}>
                <Pressable style={styles.buttonSecondary} onPress={() => void cancelGoalPicker()}>
                  <Text style={styles.buttonText}>Annuleer</Text>
                </Pressable>
                <Pressable style={styles.buttonSecondary} onPress={() => void confirmGoalFromPicker(null)}>
                  <Text style={styles.buttonText}>Zonder scorer</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, !selectedGoalScorerId ? styles.buttonDisabled : null]}
                  disabled={!selectedGoalScorerId}
                  onPress={() => void confirmGoalFromPicker(selectedGoalScorerId)}
                >
                  <Text style={styles.buttonText}>Bevestig</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
          <View style={styles.tabBar}>
            {[
              { id: "operator", label: "Wedstrijd" },
              { id: "setup", label: "Setup" },
              { id: "media", label: "Media" },
              { id: "display", label: "Display" },
              { id: "settings", label: "Koppeling" },
            ].map((tab) => (
              <Pressable
                key={tab.id}
                style={[styles.tabButton, activeTab === tab.id ? styles.tabButtonActive : null]}
                onPress={() => {
                  setActiveTab(tab.id);
                  setMenuOpen(false);
                }}
              >
                <Text style={[styles.tabText, activeTab === tab.id ? styles.tabTextActive : null]}>{tab.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {activeTab === "settings" && (
        <>
        <View style={styles.card}>
          <Text style={styles.label}>Koppeling</Text>
          <Text style={styles.label}>Bridge URL</Text>
          <TextInput
            style={styles.input}
            value={baseUrl}
            onChangeText={(value) => {
              resetSessionForConnectionChange();
              setBaseUrl(value);
            }}
            autoCapitalize="none"
            placeholder="http://192.168.x.x:17890"
            placeholderTextColor="#666"
          />
          <Text style={styles.label}>Koppelcode of QR-code tekst</Text>
          <TextInput
            style={styles.input}
            value={customerPairCode}
            onChangeText={setCustomerPairCode}
            autoCapitalize="none"
            placeholder="ACPAIR:..."
            placeholderTextColor="#666"
          />
          <View style={styles.row}>
            <Pressable style={styles.buttonSecondary} onPress={openQrScanner}>
              <Text style={styles.buttonText}>Scan QR</Text>
            </Pressable>
            <Pressable style={styles.buttonSecondary} onPress={applyPairCodeFromInput}>
              <Text style={styles.buttonText}>Gebruik code</Text>
            </Pressable>
          </View>
          {scannerOpen && (
            <View style={styles.scannerCard}>
              <CameraView
                style={styles.scanner}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={hasScanned ? undefined : handleBarcodeScanned}
              />
              <Pressable style={styles.buttonSecondary} onPress={() => setScannerOpen(false)}>
                <Text style={styles.buttonText}>Scanner sluiten</Text>
              </Pressable>
            </View>
          )}
          <Text style={styles.label}>Connectiemodus</Text>
          <View style={styles.row}>
            <Pressable
              style={[styles.buttonSecondary, connectionMode === "cloud" ? styles.activeBorder : null]}
              onPress={() => {
                resetSessionForConnectionChange();
                setConnectionMode("cloud");
              }}
            >
              <Text style={styles.buttonText}>Cloud (Optie A)</Text>
            </Pressable>
            <Pressable
              style={[styles.buttonSecondary, connectionMode === "local" ? styles.activeBorder : null]}
              onPress={() => {
                resetSessionForConnectionChange();
                setConnectionMode("local");
              }}
            >
              <Text style={styles.buttonText}>Lokaal LAN</Text>
            </Pressable>
          </View>
          {isCloud && (
            <>
              <Text style={styles.label}>Venue ID</Text>
              <TextInput
                style={styles.input}
                value={venueId}
                onChangeText={(value) => {
                  resetSessionForConnectionChange();
                  setVenueId(value);
                }}
                autoCapitalize="none"
                placeholder="bv. genk-a"
                placeholderTextColor="#666"
              />
            </>
          )}
          <Text style={styles.label}>Rol</Text>
          <View style={styles.row}>
            <Pressable
              style={[styles.buttonSecondary, role === "viewer" ? styles.activeBorder : null]}
              onPress={() => {
                resetSessionForConnectionChange();
                setRole("viewer");
              }}
            >
              <Text style={styles.buttonText}>Viewer</Text>
            </Pressable>
            <Pressable
              style={[styles.buttonSecondary, role === "operator" ? styles.activeBorder : null]}
              onPress={() => {
                resetSessionForConnectionChange();
                setRole("operator");
              }}
            >
              <Text style={styles.buttonText}>Operator</Text>
            </Pressable>
          </View>
          {role === "operator" && (
            <>
              <Text style={styles.label}>Operator PIN</Text>
              <TextInput
                style={styles.input}
                value={operatorPin}
                onChangeText={(value) => {
                  resetSessionForConnectionChange();
                  setOperatorPin(value);
                }}
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
                onChangeText={(value) => {
                  resetSessionForConnectionChange();
                  setPairingCode(value);
                }}
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
          <Text style={styles.label}>Status</Text>
          <Text style={styles.status}>{status}</Text>
          <Text style={styles.label}>Laatste snapshot</Text>
          <Text style={styles.snapshot}>
            {snapshot ? JSON.stringify(snapshot, null, 2) : "Nog geen data"}
          </Text>
        </View>
        </>
        )}

        {activeTab === "setup" && (
          <SetupScreen
            styles={styles}
            canCall={canCall}
            canMutate={canMutate}
            isCloud={isCloud}
            baseUrl={baseUrl}
            sessionToken={sessionToken}
            callBridge={callBridge}
            onStatus={setStatus}
          />
        )}

        {activeTab === "media" && (
          <MediaScreen
            styles={styles}
            canCall={canCall}
            canMutate={canMutate}
            isCloud={isCloud}
            baseUrl={baseUrl}
            sessionToken={sessionToken}
            callBridge={callBridge}
            sendCommand={sendCommand}
            onStatus={setStatus}
          />
        )}

        {activeTab === "display" && (
          <DisplayScreen
            styles={styles}
            canMutate={canMutate}
            sendCommand={sendCommand}
            snapshot={snapshot}
            activeMatchDetails={activeMatchDetails}
            onStatus={setStatus}
          />
        )}

        {activeTab === "operator" && (
        <>
        <View style={styles.card}>
          <Text style={styles.label}>Timer snel</Text>
          <View style={styles.grid}>
            {[
              { preset: "FIRST_HALF", label: "1e 45'" },
              { preset: "SECOND_HALF", label: "2e 45'" },
              { preset: "ET1", label: "Vl. 1" },
              { preset: "ET2", label: "Vl. 2" },
            ].map((item) => (
              <Pressable
                key={item.preset}
                style={styles.smallButton}
                onPress={() => sendCommand({ type: "timer:preset", preset: item.preset })}
              >
                <Text style={styles.buttonTextSmall}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable
              style={styles.buttonSecondary}
              onPress={() => sendCommand({ type: "timer:adjust", deltaSec: 60 })}
            >
              <Text style={styles.buttonText}>+1 min klok</Text>
            </Pressable>
            <Pressable
              style={styles.buttonSecondary}
              onPress={() => sendCommand({ type: "timer:adjust", deltaSec: -60 })}
            >
              <Text style={styles.buttonText}>−1 min klok</Text>
            </Pressable>
          </View>
          <Text style={styles.subLabel}>Extra tijd (min)</Text>
          <View style={styles.chipsRow}>
            {[0, 1, 2, 3, 4, 5].map((minutes) => (
              <Pressable
                key={minutes}
                style={styles.chip}
                onPress={() => sendCommand({ type: "timer:setAddedTime", minutes })}
              >
                <Text style={styles.chipText}>{minutes}</Text>
              </Pressable>
            ))}
          </View>
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
              <Text style={styles.status}>
                Stap 1: start de goalvisual. Stap 2: kies de scorer en bevestig.
              </Text>
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
                  style={[styles.buttonSecondary, preparedGoalSide === activeTeamSide ? styles.activeBorder : null]}
                  onPress={() => prepareGoal(activeTeamSide)}
                >
                  <Text style={styles.buttonText}>Start goalvisual</Text>
                </Pressable>
                <Pressable
                  style={styles.button}
                  onPress={confirmGoal}
                >
                  <Text style={styles.buttonText}>
                    {selectedGoalScorerId ? "Bevestig scorer" : "Goal zonder scorer"}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.buttonSecondary}
                  onPress={async () => {
                    await sendCommand({ type: "goal:cancel" });
                    setPreparedGoalSide(null);
                  }}
                >
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
        </>
        )}
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
    padding: 14,
    gap: 14,
    backgroundColor: "#020617",
  },
  remoteHeader: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  headerIconButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIconText: {
    color: "#ffffff",
    fontSize: 34,
    fontWeight: "800",
  },
  brandCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandLogo: {
    width: 54,
    height: 54,
    borderRadius: 16,
  },
  brandArena: {
    color: "#ffffff",
    fontSize: 27,
    fontWeight: "900",
    lineHeight: 28,
  },
  brandControl: {
    color: "#0ea5e9",
    fontSize: 27,
    fontWeight: "900",
    lineHeight: 28,
  },
  menuCard: {
    borderRadius: 18,
    padding: 10,
    gap: 8,
    backgroundColor: "#071426",
    borderWidth: 1,
    borderColor: "#12375f",
  },
  menuButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  menuButtonActive: {
    backgroundColor: "#2563eb",
    borderColor: "#60a5fa",
  },
  menuButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    textAlign: "center",
  },
  connectionPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#12375f",
    backgroundColor: "#061224",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  connectionDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },
  connectionDotOnline: {
    backgroundColor: "#22c55e",
  },
  connectionDotOffline: {
    backgroundColor: "#f59e0b",
  },
  connectionPillText: {
    color: "#e0f2fe",
    fontSize: 12,
    fontWeight: "800",
  },
  connectionPillSub: {
    color: "#60a5fa",
    fontSize: 11,
    fontWeight: "700",
  },
  remotePanel: {
    borderRadius: 28,
    padding: 14,
    gap: 14,
    backgroundColor: "#020b18",
    borderWidth: 1,
    borderColor: "#0ea5e9",
    shadowColor: "#0ea5e9",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  remoteTimerCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#22d3ee",
    backgroundColor: "#020817",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
  },
  remoteTimerValue: {
    color: "#ffffff",
    fontSize: 72,
    fontWeight: "900",
    letterSpacing: 1,
    lineHeight: 78,
  },
  remoteTimerState: {
    color: "#7dd3fc",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  remoteScoreCard: {
    minHeight: 188,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#0ea5e9",
    backgroundColor: "#020817",
  },
  scoreSide: {
    flex: 1,
    justifyContent: "center",
    padding: 18,
    backgroundColor: "#0759b8",
  },
  scoreLabel: {
    color: "#ffffff",
    fontSize: 25,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  scoreNumber: {
    color: "#ffffff",
    fontSize: 88,
    fontWeight: "900",
    lineHeight: 98,
  },
  scoreDash: {
    width: 78,
    color: "#ffffff",
    backgroundColor: "#020817",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 54,
    fontWeight: "900",
  },
  remoteButtonRow: {
    flexDirection: "row",
    gap: 12,
  },
  remoteActionButton: {
    flex: 1,
    minHeight: 92,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0878dc",
    borderWidth: 1,
    borderColor: "#38bdf8",
  },
  remoteGhostButton: {
    flex: 1,
    minHeight: 92,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#07182d",
    borderWidth: 1,
    borderColor: "#1f4970",
  },
  remoteDarkButton: {
    flex: 1,
    minHeight: 92,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#061426",
    borderWidth: 1,
    borderColor: "#1f4970",
  },
  remotePlayButton: {
    flex: 1.4,
    minHeight: 92,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0ea5e9",
    borderWidth: 1,
    borderColor: "#67e8f9",
  },
  remoteActionMain: {
    color: "#ffffff",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 36,
  },
  remoteActionSub: {
    color: "#e0f2fe",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  remoteIcon: {
    color: "#ffffff",
    fontSize: 44,
    fontWeight: "900",
  },
  remotePlayIcon: {
    color: "#ffffff",
    fontSize: 48,
    fontWeight: "900",
  },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    backgroundColor: "rgba(2, 6, 23, 0.84)",
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 22,
    padding: 14,
    gap: 12,
    backgroundColor: "#071426",
    borderWidth: 1,
    borderColor: "#38bdf8",
  },
  modalHeader: {
    gap: 4,
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },
  modalSubtitle: {
    color: "#93c5fd",
    fontSize: 14,
    fontWeight: "700",
  },
  modalPlayerList: {
    maxHeight: 360,
  },
  modalPlayerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 4,
  },
  modalPlayerButton: {
    width: "48%",
    minHeight: 72,
    borderRadius: 14,
    padding: 10,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    justifyContent: "center",
  },
  modalPlayerButtonActive: {
    borderColor: "#60a5fa",
    borderWidth: 2,
    backgroundColor: "#12375f",
  },
  modalPlayerNumber: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900",
  },
  modalPlayerName: {
    color: "#e2e8f0",
    fontSize: 12,
    marginTop: 2,
  },
  modalFooter: {
    flexDirection: "row",
    gap: 8,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    padding: 14,
    gap: 12,
    backgroundColor: "#101827",
    borderWidth: 1,
    borderColor: "#1d4ed8",
  },
  logo: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: "#fff",
  },
  heroText: {
    flex: 1,
    gap: 3,
  },
  heroEyebrow: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  heroSub: {
    color: "#bfdbfe",
    lineHeight: 18,
  },
  tabBarScroll: {
    flexGrow: 1,
  },
  tabBar: {
    flexDirection: "row",
    gap: 8,
    padding: 4,
    borderRadius: 14,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1e293b",
    minWidth: "100%",
  },
  tabButton: {
    minWidth: 92,
    flexGrow: 1,
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  tabButtonActive: {
    backgroundColor: "#2563eb",
  },
  tabText: {
    color: "#94a3b8",
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#ffffff",
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
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#27272a",
    gap: 8,
  },
  statusCard: {
    backgroundColor: "#071426",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#12375f",
    gap: 8,
  },
  statusTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  statusMuted: {
    color: "#93c5fd",
    marginTop: 3,
    lineHeight: 18,
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
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flex: 1,
    alignItems: "center",
  },
  buttonSecondary: {
    backgroundColor: "#334155",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flex: 1,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.45,
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
  timerPanel: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: "#1d4ed8",
    alignItems: "center",
  },
  timerLabel: {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  timerValue: {
    color: "#ffffff",
    fontSize: 48,
    fontWeight: "900",
    letterSpacing: 2,
    marginTop: 2,
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
  scannerCard: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    padding: 8,
    gap: 8,
    backgroundColor: "#020617",
  },
  scanner: {
    height: 260,
    overflow: "hidden",
    borderRadius: 10,
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
