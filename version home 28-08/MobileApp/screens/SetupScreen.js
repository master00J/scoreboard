import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { createBridgeApi } from "../lib/bridgeApi";

function fullName(player) {
  return `#${player.number} ${player.firstName} ${player.lastName}`;
}

export function SetupScreen({
  styles,
  canCall,
  canMutate,
  isCloud,
  baseUrl,
  sessionToken,
  callBridge,
  onStatus,
}) {
  const api = useMemo(
    () => createBridgeApi({ baseUrl, sessionToken, isCloud, callBridge }),
    [baseUrl, sessionToken, isCloud, callBridge],
  );

  const [teams, setTeams] = useState([]);
  const [settings, setSettings] = useState(null);
  const [matches, setMatches] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [playerDraft, setPlayerDraft] = useState({ number: "10", firstName: "", lastName: "" });

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;
  const players = selectedTeam?.players ?? [];

  const reload = useCallback(async () => {
    if (!canCall || isCloud) return;
    setBusy(true);
    try {
      const [tRes, sRes, mRes] = await Promise.all([api.get("/teams"), api.get("/settings"), api.get("/matches")]);
      if (tRes.ok && Array.isArray(tRes.data)) setTeams(tRes.data);
      if (sRes.ok && sRes.data) setSettings(sRes.data);
      if (mRes.ok && Array.isArray(mRes.data)) setMatches(mRes.data);
      onStatus?.("Setup-data geladen");
    } catch (e) {
      onStatus?.(`Setup laden mislukt: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [api, canCall, isCloud, onStatus]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function patchSettings(patch) {
    if (!canMutate) return;
    const res = await api.patch("/settings", patch);
    if (!res.ok) {
      onStatus?.(res.data?.error || "Instellingen opslaan mislukt");
      return;
    }
    await reload();
  }

  async function createTeam() {
    if (!canMutate || !newTeamName.trim()) return;
    const res = await api.post("/teams", {
      name: newTeamName.trim(),
      shortName: newTeamName.trim().slice(0, 3).toUpperCase(),
      primaryColor: "#1d4ed8",
      secondaryColor: "#ffffff",
    });
    if (!res.ok) {
      onStatus?.(res.data?.error || "Team aanmaken mislukt");
      return;
    }
    setNewTeamName("");
    await reload();
  }

  async function deleteTeam(teamId) {
    if (!canMutate) return;
    const res = await api.delete(`/teams/${teamId}`);
    if (!res.ok) {
      onStatus?.(res.data?.error || "Team verwijderen mislukt");
      return;
    }
    await reload();
  }

  async function addPlayer() {
    if (!canMutate || !selectedTeam) return;
    const res = await api.post("/players", {
      teamId: selectedTeam.id,
      number: Number.parseInt(playerDraft.number, 10) || 0,
      firstName: playerDraft.firstName.trim(),
      lastName: playerDraft.lastName.trim(),
      position: null,
      isCoach: false,
    });
    if (!res.ok) {
      onStatus?.(res.data?.error || "Speler toevoegen mislukt");
      return;
    }
    setPlayerDraft({ number: "10", firstName: "", lastName: "" });
    await reload();
  }

  async function deletePlayer(playerId) {
    if (!canMutate) return;
    const res = await api.delete(`/players/${playerId}`);
    if (!res.ok) {
      onStatus?.(res.data?.error || "Speler verwijderen mislukt");
      return;
    }
    await reload();
  }

  if (isCloud) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Setup via cloud</Text>
        <Text style={styles.status}>
          Teams, spelers en instellingen bewerk je via LAN (Bridge URL = pc-IP:17890). Cloud is bedoeld voor live
          bediening op afstand.
        </Text>
      </View>
    );
  }

  if (!canCall) {
    return (
      <View style={styles.card}>
        <Text style={styles.status}>Koppel eerst als operator via het tabblad Koppeling.</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Setup &amp; wedstrijdvoorbereiding</Text>
          <Pressable style={styles.buttonSecondary} onPress={() => void reload()} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "…" : "Herlaad"}</Text>
          </Pressable>
        </View>
        {!canMutate ? (
          <Text style={styles.status}>Alleen-lezen: log in als operator om wijzigingen op te slaan.</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Thuisploeg &amp; goalvisuals</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipsRow}>
            <Pressable
              style={[styles.chip, !settings?.homeTeamId ? styles.activeBorder : null]}
              onPress={() => canMutate && patchSettings({ homeTeamId: null })}
            >
              <Text style={styles.chipText}>Geen vast thuisteam</Text>
            </Pressable>
            {teams.map((team) => (
              <Pressable
                key={team.id}
                style={[styles.chip, settings?.homeTeamId === team.id ? styles.activeBorder : null]}
                onPress={() => canMutate && patchSettings({ homeTeamId: team.id })}
              >
                <Text style={styles.chipText}>{team.name}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <View style={styles.row}>
          <Pressable
            style={[styles.buttonSecondary, settings?.goalVisualHomeEnabled !== false ? styles.activeBorder : null]}
            onPress={() => canMutate && patchSettings({ goalVisualHomeEnabled: true })}
          >
            <Text style={styles.buttonText}>Goal visual thuis AAN</Text>
          </Pressable>
          <Pressable
            style={[styles.buttonSecondary, settings?.goalVisualHomeEnabled === false ? styles.activeBorderWarn : null]}
            onPress={() => canMutate && patchSettings({ goalVisualHomeEnabled: false })}
          >
            <Text style={styles.buttonText}>Goal visual thuis UIT</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          <Pressable
            style={[styles.buttonSecondary, settings?.goalVisualAwayEnabled !== false ? styles.activeBorder : null]}
            onPress={() => canMutate && patchSettings({ goalVisualAwayEnabled: true })}
          >
            <Text style={styles.buttonText}>Goal visual uit AAN</Text>
          </Pressable>
          <Pressable
            style={[styles.buttonSecondary, settings?.goalVisualAwayEnabled === false ? styles.activeBorderWarn : null]}
            onPress={() => canMutate && patchSettings({ goalVisualAwayEnabled: false })}
          >
            <Text style={styles.buttonText}>Goal visual uit UIT</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Teams</Text>
        {canMutate ? (
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={newTeamName}
              onChangeText={setNewTeamName}
              placeholder="Nieuwe clubnaam"
              placeholderTextColor="#666"
            />
            <Pressable style={styles.button} onPress={() => void createTeam()}>
              <Text style={styles.buttonText}>+ Team</Text>
            </Pressable>
          </View>
        ) : null}
        {teams.map((team) => (
          <Pressable
            key={team.id}
            style={[styles.matchItem, selectedTeamId === team.id ? styles.matchItemActive : null]}
            onPress={() => setSelectedTeamId(team.id)}
          >
            <Text style={styles.matchTitle}>{team.name}</Text>
            <Text style={styles.matchSub}>{team.players?.length ?? 0} spelers</Text>
            {canMutate ? (
              <Pressable style={styles.buttonSecondary} onPress={() => void deleteTeam(team.id)}>
                <Text style={styles.buttonTextSmall}>Verwijder</Text>
              </Pressable>
            ) : null}
          </Pressable>
        ))}
      </View>

      {selectedTeam ? (
        <View style={styles.card}>
          <Text style={styles.label}>Spelers — {selectedTeam.name}</Text>
          {canMutate ? (
            <>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { width: 56 }]}
                  value={playerDraft.number}
                  onChangeText={(v) => setPlayerDraft((d) => ({ ...d, number: v }))}
                  keyboardType="number-pad"
                  placeholder="#"
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={playerDraft.firstName}
                  onChangeText={(v) => setPlayerDraft((d) => ({ ...d, firstName: v }))}
                  placeholder="Voornaam"
                  placeholderTextColor="#666"
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={playerDraft.lastName}
                  onChangeText={(v) => setPlayerDraft((d) => ({ ...d, lastName: v }))}
                  placeholder="Achternaam"
                  placeholderTextColor="#666"
                />
              </View>
              <Pressable style={styles.button} onPress={() => void addPlayer()}>
                <Text style={styles.buttonText}>Speler toevoegen</Text>
              </Pressable>
            </>
          ) : null}
          {players.map((player) => (
            <View key={player.id} style={styles.matchItem}>
              <Text style={styles.matchTitle}>{fullName(player)}</Text>
              {canMutate ? (
                <Pressable style={styles.buttonSecondary} onPress={() => void deletePlayer(player.id)}>
                  <Text style={styles.buttonTextSmall}>Verwijder</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          <Text style={styles.status}>
            Spelerfoto&apos;s en goal-video&apos;s stel je het makkelijkst in via de desktop Setup-tab (bestand kiezen).
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>Geplande wedstrijden ({matches.length})</Text>
        {matches.slice(0, 12).map((m) => (
          <View key={m.id} style={styles.matchItem}>
            <Text style={styles.matchTitle}>
              {m.homeTeam?.name ?? "?"} vs {m.awayTeam?.name ?? "?"}
            </Text>
            <Text style={styles.matchSub}>
              {m.status} · {m.kickoffAt ? new Date(m.kickoffAt).toLocaleString("nl-BE") : "Geen kickoff"}
            </Text>
          </View>
        ))}
        <Text style={styles.status}>
          Nieuwe wedstrijden aanmaken, kickoff en matchsponsor: desktop Setup (of volgende app-update).
        </Text>
      </View>
    </>
  );
}
