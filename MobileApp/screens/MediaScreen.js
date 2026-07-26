import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { createBridgeApi } from "../lib/bridgeApi";

const BUDGET_FIELDS = [
  { key: "prematchSeconds", label: "Voor wedstrijd" },
  { key: "halftimeSeconds", label: "Rust" },
  { key: "matchFirstHalfSeconds", label: "1e helft" },
  { key: "matchSecondHalfSeconds", label: "2e helft" },
];

export function MediaScreen({
  styles,
  canCall,
  canMutate,
  isCloud,
  baseUrl,
  sessionToken,
  callBridge,
  sendCommand,
  onStatus,
}) {
  const api = useMemo(
    () => createBridgeApi({ baseUrl, sessionToken, isCloud, callBridge }),
    [baseUrl, sessionToken, isCloud, callBridge],
  );

  const [sponsors, setSponsors] = useState([]);
  const [media, setMedia] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [expandedSponsorId, setExpandedSponsorId] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!canCall || isCloud) return;
    setBusy(true);
    try {
      const [sRes, mRes, pRes] = await Promise.all([
        api.get("/sponsors"),
        api.get("/media"),
        api.get("/playlists"),
      ]);
      if (sRes.ok && Array.isArray(sRes.data)) setSponsors(sRes.data);
      if (mRes.ok && Array.isArray(mRes.data)) setMedia(mRes.data.filter((m) => m.active));
      if (pRes.ok && Array.isArray(pRes.data)) setPlaylists(pRes.data);
      onStatus?.("Media-data geladen");
    } catch (e) {
      onStatus?.(`Media laden mislukt: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [api, canCall, isCloud, onStatus]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function patchSponsor(id, patch) {
    if (!canMutate) return;
    const res = await api.patch(`/sponsors/${id}`, patch);
    if (!res.ok) {
      onStatus?.(res.data?.error || "Sponsor opslaan mislukt");
      return;
    }
    await reload();
  }

  async function playMedia(mediaId) {
    if (!canMutate) return;
    await sendCommand({
      type: "display:setMode",
      mode: "SPONSOR",
      meta: { activeMediaId: mediaId },
    });
    onStatus?.("Media naar display gestuurd");
  }

  async function playPlaylistItem(mediaId) {
    if (!canMutate) return;
    await sendCommand({
      type: "display:setMode",
      mode: "CUSTOM",
      meta: { activeMediaId: mediaId },
    });
    onStatus?.("Playlist-item naar display");
  }

  if (isCloud) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Media via cloud</Text>
        <Text style={styles.status}>
          Sponsorbudgetten en mediabibliotheek beheer je via LAN op de wedstrijd-pc. In cloud kun je wel handmatige
          display-commando's sturen vanaf Wedstrijd/Display als de desktop state meegeeft.
        </Text>
      </View>
    );
  }

  if (!canCall) {
    return (
      <View style={styles.card}>
        <Text style={styles.status}>Koppel eerst als operator.</Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Sponsors &amp; media</Text>
          <Pressable style={styles.buttonSecondary} onPress={() => void reload()} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "…" : "Herlaad"}</Text>
          </Pressable>
        </View>
        {!canMutate ? <Text style={styles.status}>Operator vereist om te wijzigen of af te spelen.</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Sponsors ({sponsors.length})</Text>
        {sponsors.map((sponsor) => (
          <View key={sponsor.id} style={styles.matchItem}>
            <Pressable onPress={() => setExpandedSponsorId((id) => (id === sponsor.id ? null : sponsor.id))}>
              <Text style={styles.matchTitle}>{sponsor.name}</Text>
              <Text style={styles.matchSub}>{sponsor.active ? "Actief" : "Inactief"}</Text>
            </Pressable>
            {canMutate ? (
              <Pressable
                style={styles.buttonSecondary}
                onPress={() => void patchSponsor(sponsor.id, { active: !sponsor.active })}
              >
                <Text style={styles.buttonTextSmall}>{sponsor.active ? "Deactiveer" : "Activeer"}</Text>
              </Pressable>
            ) : null}
            {expandedSponsorId === sponsor.id && canMutate ? (
              <View style={{ marginTop: 8, gap: 6 }}>
                {BUDGET_FIELDS.map(({ key, label }) => (
                  <View key={key} style={styles.row}>
                    <Text style={[styles.subLabel, { width: 100 }]}>{label}</Text>
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      keyboardType="number-pad"
                      defaultValue={String(sponsor[key] ?? 0)}
                      onEndEditing={(e) => {
                        const n = Number.parseInt(e.nativeEvent.text, 10);
                        if (Number.isFinite(n) && n >= 0) {
                          void patchSponsor(sponsor.id, { [key]: n });
                        }
                      }}
                    />
                    <Text style={styles.matchSub}>sec</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        <Text style={styles.status}>Nieuwe sponsors en mediakoppelingen: desktop Media-tab (uploads).</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Bibliotheek — handmatig tonen</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipsRow}>
            {media.slice(0, 40).map((item) => (
              <Pressable key={item.id} style={styles.chip} onPress={() => void playMedia(item.id)}>
                <Text style={styles.chipText}>{item.title || item.id.slice(0, 8)}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Playlists</Text>
        {playlists.map((pl) => (
          <View key={pl.id} style={{ marginBottom: 10 }}>
            <Text style={styles.subLabel}>
              {pl.slot} — {pl.name}
            </Text>
            {(pl.items ?? []).slice(0, 8).map((item) => (
              <Pressable
                key={item.id}
                style={styles.buttonSecondary}
                onPress={() => void playPlaylistItem(item.mediaId)}
              >
                <Text style={styles.buttonTextSmall}>{item.media?.title ?? item.mediaId}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </>
  );
}
