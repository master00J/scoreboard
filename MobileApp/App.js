import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const defaultBaseUrl = "http://192.168.1.10:17890";
const defaultToken = "";

async function callBridge(baseUrl, token, path, method = "GET", body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Scoreboard-Token": token,
    },
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
  const [token, setToken] = useState(defaultToken);
  const [status, setStatus] = useState("Nog niet verbonden");
  const [snapshot, setSnapshot] = useState(null);

  const canCall = useMemo(
    () => baseUrl.trim().length > 0 && token.trim().length > 0,
    [baseUrl, token],
  );

  async function pingHealth() {
    setStatus("Bridge pingen...");
    try {
      const res = await fetch(`${baseUrl}/mobile/health`);
      const payload = await res.json();
      setStatus(
        res.ok
          ? `Bridge online: ${payload.service}`
          : `Fout: ${res.status}`,
      );
    } catch (error) {
      setStatus(`Niet bereikbaar: ${String(error)}`);
    }
  }

  async function loadSnapshot() {
    if (!canCall) return;
    setStatus("Snapshot laden...");
    try {
      const response = await callBridge(baseUrl, token, "/mobile/snapshot");
      if (!response.ok) {
        setStatus(`Snapshot fout (${response.status})`);
        return;
      }
      setSnapshot(response.data);
      setStatus("Snapshot geladen");
    } catch (error) {
      setStatus(`Snapshot mislukt: ${String(error)}`);
    }
  }

  async function sendCommand(command) {
    if (!canCall) return;
    setStatus(`Command ${command.type} verzenden...`);
    try {
      const response = await callBridge(baseUrl, token, "/mobile/command", "POST", {
        command,
      });
      if (!response.ok) {
        setStatus(`Command fout (${response.status})`);
        return;
      }
      setStatus(`Command verwerkt: ${JSON.stringify(response.data)}`);
      await loadSnapshot();
    } catch (error) {
      setStatus(`Command mislukt: ${String(error)}`);
    }
  }

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
          <Text style={styles.label}>Bridge token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            placeholder="token uit desktop boot.log"
            placeholderTextColor="#666"
          />
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={pingHealth}>
              <Text style={styles.buttonText}>Ping</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={loadSnapshot}>
              <Text style={styles.buttonText}>Snapshot</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Snelle bediening</Text>
          <View style={styles.row}>
            <Pressable
              style={styles.button}
              onPress={() => sendCommand({ type: "timer:toggle" })}
            >
              <Text style={styles.buttonText}>Start/Pauze</Text>
            </Pressable>
            <Pressable
              style={styles.button}
              onPress={() => sendCommand({ type: "timer:set", seconds: 0 })}
            >
              <Text style={styles.buttonText}>Reset timer</Text>
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
  button: {
    backgroundColor: "#2563eb",
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
  status: {
    color: "#93c5fd",
  },
  snapshot: {
    color: "#c4b5fd",
    fontSize: 12,
    fontFamily: "monospace",
  },
});
