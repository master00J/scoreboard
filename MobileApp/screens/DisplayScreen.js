import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chip, ConfirmButton, sharedStyles as s } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { sportProfile } from '../lib/match-state';
import { colors } from '../lib/theme';

const MODES = ['MATCH', 'SPONSOR_ROTATION', 'IDLE', 'HALFTIME', 'FULLTIME', 'TEAM_INTRO', 'PLAYER_INTRO'];
const PRESETS = ['FIRST_HALF', 'SECOND_HALF', 'ET1', 'ET2'];
const KNOWN_MODES = [...MODES, 'BLACKOUT', 'SPONSOR', 'CUSTOM', 'GOAL', 'GOAL_INTRO_VIDEO', 'GOAL_PLAYER_VIDEO', 'SUBSTITUTION', 'CARD'];

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
  const sport = String(activeMatchDetails?.sport || "FOOTBALL").toUpperCase();
  const showTimerPresets = sport === "FOOTBALL";
  const homePlayers = activeMatchDetails?.homeTeam?.players ?? [];
  const awayPlayers = activeMatchDetails?.awayTeam?.players ?? [];
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
  const setMode = (mode, meta) => act({ type: 'display:setMode', mode, ...(meta ? { meta } : {}) });
  return <>
    <Card title={t('display.title')} subtitle={t('display.subtitle')}>
      <View style={{ padding: 14, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line }}>
        <Text accessibilityLiveRegion="polite" style={[s.text, { color: colors.accent }]}>{t('display.current', { mode: snapshot?.safeMode ? t('display.safeMode') : activeMode })}</Text>
      </View>

      {showTimerPresets ? (
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
      </View>
      ) : null}
      {sport !== "VOLLEYBALL" ? (
      <View style={styles.card}>
        <Text style={styles.label}>Timer</Text>
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
      ) : null}

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
