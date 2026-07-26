import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

const DISPLAY_MODES = [
  { mode: "MATCH", label: "Match" },
  { mode: "SPONSOR_ROTATION", label: "Sponsorrotatie" },
  { mode: "IDLE", label: "Idle" },
  { mode: "HALFTIME", label: "Halftime" },
  { mode: "FULLTIME", label: "Fulltime" },
  { mode: "TEAM_INTRO", label: "Team intro" },
  { mode: "PLAYER_INTRO", label: "Spelerintro" },
  { mode: "BLACKOUT", label: "Blackout" },
];

const TIMER_PRESETS = [
  { type: "timer:preset", preset: "FIRST_HALF", label: "1e helft 45'" },
  { type: "timer:preset", preset: "SECOND_HALF", label: "2e helft 45'" },
  { type: "timer:preset", preset: "ET1", label: "Vl. 1" },
  { type: "timer:preset", preset: "ET2", label: "Vl. 2" },
];

export function DisplayScreen({
  styles,
  canMutate,
  sendCommand,
  snapshot,
  activeMatchDetails,
  onStatus,
}) {
  const homePlayers = activeMatchDetails?.homeTeam?.players ?? [];
  const awayPlayers = activeMatchDetails?.awayTeam?.players ?? [];
  const safeMode = snapshot?.safeMode ?? false;

  const allPlayers = useMemo(
    () => [
      ...homePlayers.map((p) => ({ ...p, side: "home" })),
      ...awayPlayers.map((p) => ({ ...p, side: "away" })),
    ],
    [homePlayers, awayPlayers],
  );

  async function setMode(mode, meta) {
    if (!canMutate) return;
    await sendCommand({ type: "display:setMode", mode, meta });
    onStatus?.(`Display: ${mode}`);
  }

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.label}>Display-modi</Text>
        {!canMutate ? <Text style={styles.status}>Operator vereist.</Text> : null}
        <View style={styles.grid}>
          {DISPLAY_MODES.map((item) => (
            <Pressable key={item.mode} style={styles.smallButton} onPress={() => void setMode(item.mode)}>
              <Text style={styles.buttonTextSmall}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => canMutate && sendCommand({ type: "display:blackout" })}>
            <Text style={styles.buttonText}>Blackout toggle</Text>
          </Pressable>
          <Pressable
            style={styles.buttonSecondary}
            onPress={() => canMutate && sendCommand({ type: "display:setSafeMode", enabled: !safeMode })}
          >
            <Text style={styles.buttonText}>Safe mode {safeMode ? "UIT" : "AAN"}</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.buttonSecondary}
          onPress={() => canMutate && sendCommand({ type: "display:setExternalCaptureToDisplay", enabled: true })}
        >
          <Text style={styles.buttonText}>Externe capture → display</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Timer presets</Text>
        <View style={styles.grid}>
          {TIMER_PRESETS.map((cmd) => (
            <Pressable
              key={cmd.preset}
              style={styles.smallButton}
              onPress={() => canMutate && sendCommand(cmd)}
            >
              <Text style={styles.buttonTextSmall}>{cmd.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <Pressable
            style={styles.buttonSecondary}
            onPress={() => canMutate && sendCommand({ type: "timer:adjust", deltaSec: 60 })}
          >
            <Text style={styles.buttonText}>+1 min</Text>
          </Pressable>
          <Pressable
            style={styles.buttonSecondary}
            onPress={() => canMutate && sendCommand({ type: "timer:adjust", deltaSec: -60 })}
          >
            <Text style={styles.buttonText}>−1 min</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Spelerintro (Start RAFC)</Text>
        {!activeMatchDetails ? (
          <Text style={styles.status}>Selecteer een actieve wedstrijd op Wedstrijd.</Text>
        ) : (
          <>
            <Pressable style={styles.button} onPress={() => void setMode("PLAYER_INTRO", { activePlayerId: null })}>
              <Text style={styles.buttonText}>Open spelerintro (leeg)</Text>
            </Pressable>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipsRow}>
                {allPlayers.map((player) => (
                  <Pressable
                    key={player.id}
                    style={styles.chip}
                    onPress={() =>
                      void setMode("PLAYER_INTRO", { activePlayerId: player.id })
                    }
                  >
                    <Text style={styles.chipText}>
                      {player.side === "away" ? "U " : "T "}#{player.number} {player.lastName}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Pressable style={styles.buttonSecondary} onPress={() => void setMode("MATCH")}>
              <Text style={styles.buttonText}>Terug naar match</Text>
            </Pressable>
          </>
        )}
      </View>
    </>
  );
}
