"use client";

import { useEffect, useState } from "react";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { useApi } from "@/lib/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Select } from "@/components/ui/form";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AppSettings, Match, MediaItem, Player, Team } from "@/lib/types";
import { toast } from "@/components/ui/toast";
import { isElectron, selectFilesViaDialog, selectFolderViaDialog, exportVenueBackup } from "@/lib/electron";
import { mediaUrl } from "@/lib/media-url";
import { PREMATCH_MATCH_SPONSOR_LEAD_MS } from "@/lib/prematch-match-sponsor";
import { SetupScoreboardTemplatesSection } from "./setup-scoreboard-templates";
import { SetupScoreboardThemeSection } from "./setup-scoreboard-theme";
import { SetupDisplayCanvasSection } from "./setup-display-canvas";
import { AssetHealthCheck } from "./asset-health-check";
import { getSportProfile, SPORT_TYPES, type SportType } from "@/lib/sports";

type VisualField = "goalVideoPath" | "subImagePath" | "lineupVideoPath";

const VISUAL_LABELS: Record<VisualField, { title: string; extensions: string[] }> = {
  goalVideoPath: {
    title: "Goal-viering video's",
    extensions: ["mp4", "webm", "mov", "m4v"],
  },
  subImagePath: {
    title: "Wissel afbeeldingen",
    extensions: ["png", "jpg", "jpeg", "webp"],
  },
  lineupVideoPath: {
    title: "Opstelling / lineup-video's (Spelerintro)",
    extensions: ["mp4", "webm", "mov", "m4v"],
  },
};

export function SetupPanel() {
  const { data: teams, reload: reloadTeams } = useApi<Team[]>("/api/teams");
  const { data: matches, reload: reloadMatches } = useApi<Match[]>("/api/matches");
  const { data: settings, reload: reloadSettings } = useApi<AppSettings>("/api/settings");
  const { data: idleFallbackPickMedia } = useApi<MediaItem[]>("/api/media");
  const state = useDisplayStore((s) => s.state);
  const homeTeam = (teams ?? []).find((team) => team.id === settings?.homeTeamId) ?? null;

  const [teamDialogTeam, setTeamDialogTeam] = useState<Team | "new" | null>(null);
  const [playerDialog, setPlayerDialog] = useState<{
    team: Team;
    player: Player | "new";
  } | null>(null);
  const [rosterDialogTeam, setRosterDialogTeam] = useState<Team | null>(null);
  const [matchDialog, setMatchDialog] = useState(false);
  const [scheduleMatch, setScheduleMatch] = useState<Match | null>(null);
  const [visualsField, setVisualsField] = useState<VisualField | null>(null);

  async function setHomeTeam(teamId: string | null) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homeTeamId: teamId }),
    });
    if (!res.ok) {
      toast({ title: "Kon home team niet opslaan", variant: "error" });
      return;
    }
    reloadSettings();
  }

  async function pickGoalIntroVideo() {
    const paths = await selectFilesViaDialog({
      title: "Selecteer algemene GOAL-intro video",
      filters: [{ name: "Video", extensions: ["mp4", "webm", "mov", "m4v"] }],
    });
    if (paths.length === 0) return;
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalIntroVideoPath: paths[0] }),
    });
    if (!res.ok) {
      toast({
        title: "Goal-intro video opslaan mislukt",
        description: await res.text(),
        variant: "error",
      });
      return;
    }
    toast({ title: "Goal-intro video ingesteld", variant: "success" });
    reloadSettings();
  }

  async function clearGoalIntroVideo() {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalIntroVideoPath: null }),
    });
    if (!res.ok) return;
    reloadSettings();
  }

  async function setGoalVisualEnabled(side: "home" | "away", enabled: boolean) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        [side === "home" ? "goalVisualHomeEnabled" : "goalVisualAwayEnabled"]: enabled,
      }),
    });
    if (!res.ok) {
      toast({ title: "Goalvisual-instelling opslaan mislukt", variant: "error" });
      return;
    }
    reloadSettings();
  }

  async function setIdleFallbackMedia(mediaId: string | null) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idleFallbackMediaId: mediaId }),
    });
    if (!res.ok) {
      toast({ title: "Standaardmedia niet opgeslagen", variant: "error" });
      return;
    }
    reloadSettings();
  }

  return (
    <div className="flex flex-col gap-6">
      {isElectron ? (
        <section className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-1">Venue-backup</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Maakt een ZIP met de lokale database (<code className="text-xs">data/stadium.db</code>) en een kopie
            van <code className="text-xs">uploads/</code>. Ook via het menu: Bestand → Exporteer venue-backup.
            Herstel: zie <code className="text-xs">docs/MATCHDAY.md</code>.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void (async () => {
                const r = await exportVenueBackup();
                if (r.canceled) return;
                if (!r.ok) {
                  toast({ title: "Backup mislukt", description: r.error ?? "", variant: "error" });
                  return;
                }
                toast({
                  title: "Backup opgeslagen",
                  description: r.filePath ?? "",
                  variant: "success",
                });
              })();
            }}
          >
            Exporteer backup (ZIP)…
          </Button>
        </section>
      ) : null}
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4 gap-4">
          <div>
            <h2 className="text-lg font-semibold">Vast home team</h2>
            <div className="text-sm text-muted-foreground">
              Dit team wordt automatisch gebruikt als thuisploeg bij nieuwe wedstrijden.
            </div>
          </div>
          {homeTeam && (
            <Button variant="outline" size="sm" onClick={() => void setHomeTeam(null)}>
              Wis home team
            </Button>
          )}
        </div>

        {homeTeam ? (
          <>
            <div className="flex items-center gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
              {homeTeam.logoPath ? (
                <img src={mediaUrl(homeTeam.logoPath)} alt="" className="h-14 w-14 rounded object-contain" />
              ) : (
                <div
                  className="flex h-14 w-14 items-center justify-center rounded text-lg font-black"
                  style={{ background: homeTeam.primaryColor, color: homeTeam.secondaryColor }}
                >
                  {homeTeam.shortName.slice(0, 3)}
                </div>
              )}
              <div>
                <div className="font-semibold text-lg">{homeTeam.name}</div>
                <div className="text-sm text-muted-foreground">{homeTeam.shortName}</div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">Algemene GOAL-video</div>
                    <div className="text-xs text-muted-foreground">
                      Gaat voor op de GOAL-playlist in Media. Daarna kies je de scorer; bij een
                      persoonlijke clip (media of geïmporteerde goal-video) volgt die viering.
                    </div>
                  </div>
                  {settings?.goalIntroVideoPath && (
                    <Button variant="ghost" size="sm" onClick={clearGoalIntroVideo}>
                      Wis
                    </Button>
                  )}
                </div>
                {settings?.goalIntroVideoPath ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <video
                      src={mediaUrl(settings.goalIntroVideoPath)}
                      muted
                      controls
                      className="w-full rounded bg-black aspect-video"
                    />
                    <div className="text-[11px] text-muted-foreground truncate" title={settings.goalIntroVideoPath}>
                      {settings.goalIntroVideoPath}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground italic">
                    Nog geen video ingesteld.
                  </div>
                )}
                <Button size="sm" variant="outline" className="mt-3" onClick={pickGoalIntroVideo}>
                  {settings?.goalIntroVideoPath ? "Video vervangen…" : "Video kiezen…"}
                </Button>
                <div className="mt-4 border-t border-border pt-3">
                  <div className="font-semibold text-sm">GOAL +1 gedrag</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Kies per ploeg of de goal-knop een visual start of enkel de score verhoogt.
                  </div>
                  <div className="mt-3 grid gap-2">
                    <label className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-xs">
                      <span>Thuisploeg: visual tonen bij goal</span>
                      <input
                        type="checkbox"
                        checked={settings?.goalVisualHomeEnabled ?? true}
                        onChange={(e) => void setGoalVisualEnabled("home", e.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-xs">
                      <span>Uitploeg: visual tonen bij goal</span>
                      <input
                        type="checkbox"
                        checked={settings?.goalVisualAwayEnabled ?? false}
                        onChange={(e) => void setGoalVisualEnabled("away", e.target.checked)}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="font-semibold mb-1">Spelers-visuals uit map importeren</div>
                <div className="text-xs text-muted-foreground mb-3">
                  Kies een map met bestanden, wijs ze handmatig aan de juiste thuisspeler toe.
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="outline" onClick={() => setVisualsField("goalVideoPath")}>
                    Goal-viering video's…
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setVisualsField("subImagePath")}>
                    Wissel-afbeeldingen…
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setVisualsField("lineupVideoPath")}>
                    Opstelling-video&apos;s (spelerintro)…
                  </Button>
                </div>
                <HomeVisualsSummary team={homeTeam} />
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Kies hieronder bij een team <strong>Set home</strong> om je vaste thuisploeg vast te leggen.
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-1">Leeg scherm (IDLE / prematch)</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
          Zonder items in de playlist toont het stadionscherm optioneel een vaste clip of afbeelding;
          anders het logo van je vaste thuisploeg. Zonder thuisploeg zie je een korte melding.
        </p>
        <div className="max-w-xl space-y-2">
          <Label htmlFor="idle-fallback-media">Standaardmedia (optioneel)</Label>
          <Select
            id="idle-fallback-media"
            value={settings?.idleFallbackMediaId ?? ""}
            onChange={(e) =>
              void setIdleFallbackMedia(e.target.value === "" ? null : e.target.value)
            }
          >
            <option value="">— Alleen thuislogo (indien ingesteld) —</option>
            {(idleFallbackPickMedia ?? [])
              .filter((m) => !m.hideFromLibrary && m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.type === "VIDEO" ? "video" : "afbeelding"})
                </option>
              ))}
          </Select>
        </div>
      </section>

      <SetupScoreboardTemplatesSection settings={settings} reloadSettings={reloadSettings} />
      <SetupScoreboardThemeSection settings={settings} reloadSettings={reloadSettings} />

      <SetupDisplayCanvasSection settings={settings ?? null} reloadSettings={reloadSettings} />

      <section className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-3">Pre-match check</h2>
        <AssetHealthCheck />
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Matches</h2>
          <Button onClick={() => setMatchDialog(true)}>New match</Button>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground max-w-3xl">
            Sluit een wedstrijd af na afloop: het display wordt losgekoppeld en je kunt geen live
            commando&apos;s meer op die wedstrijd sturen. Alle sponsor-play logs blijven aan deze
            match hangen — filter in Rapporten op wedstrijd voor proof-of-play per wedstrijd.
          </p>
          {(matches ?? []).map((m) => (
            <div
              key={m.id}
              className={`flex items-center justify-between rounded-lg border p-3 ${
                state?.matchId === m.id ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <div className="flex items-center gap-3 flex-wrap">
                <div className="font-semibold">{m.homeTeam.name}</div>
                <div className="text-muted-foreground text-sm">vs</div>
                <div className="font-semibold">{m.awayTeam.name}</div>
                <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  {getSportProfile(m.sport).label}
                </span>
                {m.closedAt ? (
                  <span className="text-[10px] uppercase tracking-wide rounded px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                    Afgesloten
                  </span>
                ) : null}
                <div className="text-xs text-muted-foreground ml-2">
                  {m.homeScore} – {m.awayScore} · {m.status}
                  {m.kickoffAt ? (
                    <>
                      {" "}
                      · aftrap{" "}
                      {new Date(m.kickoffAt).toLocaleString("nl-NL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </>
                  ) : null}
                  {m.matchSponsorMediaId ? " · matchsponsor" : ""}
                  {m.closedAt ? (
                    <>
                      {" "}
                      · gesloten{" "}
                      {new Date(m.closedAt).toLocaleString("nl-NL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <Button size="sm" variant="outline" onClick={() => setScheduleMatch(m)}>
                  Aftrap
                </Button>
                {state?.matchId === m.id ? (
                  <Button variant="secondary" disabled size="sm">
                    Actief
                  </Button>
                ) : m.closedAt ? (
                  <Button variant="secondary" disabled size="sm" title="Afgesloten wedstrijd kan niet actief worden">
                    Activeren
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      sendCommand({ type: "match:setActive", matchId: m.id })
                    }
                  >
                    Activeren
                  </Button>
                )}
                {!m.closedAt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (
                        !confirm(
                          `Wedstrijd "${m.homeTeam.name} vs ${m.awayTeam.name}" afsluiten?\n\n` +
                            "Het display wordt losgekoppeld van deze wedstrijd (indien actief). " +
                            "Sponsor-play logs blijven bewaard voor rapportage per wedstrijd.",
                        )
                      ) {
                        return;
                      }
                      const res = await fetch(`/api/matches/${m.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ closedAt: new Date().toISOString() }),
                      });
                      if (!res.ok) {
                        toast({
                          title: "Afsluiten mislukt",
                          description: await res.text(),
                          variant: "error",
                        });
                        return;
                      }
                      toast({ title: "Wedstrijd afgesloten", variant: "success" });
                      reloadMatches();
                    }}
                  >
                    Afsluiten
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (
                        !confirm(
                          `Wedstrijd "${m.homeTeam.name} vs ${m.awayTeam.name}" opnieuw openen voor live bediening?`,
                        )
                      ) {
                        return;
                      }
                      const res = await fetch(`/api/matches/${m.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ closedAt: null }),
                      });
                      if (!res.ok) {
                        toast({
                          title: "Heropenen mislukt",
                          description: await res.text(),
                          variant: "error",
                        });
                        return;
                      }
                      toast({ title: "Wedstrijd heropend", variant: "success" });
                      reloadMatches();
                    }}
                  >
                    Heropenen
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm("Delete this match?")) return;
                    await fetch(`/api/matches/${m.id}`, { method: "DELETE" });
                    reloadMatches();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {matches?.length === 0 && (
            <div className="text-sm text-muted-foreground">No matches yet.</div>
          )}
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Teams & Players</h2>
          <Button onClick={() => setTeamDialogTeam("new")}>New team</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(teams ?? []).map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              isHome={team.id === settings?.homeTeamId}
              onEdit={() => setTeamDialogTeam(team)}
              onEditRoster={() => setRosterDialogTeam(team)}
              onEditPlayer={(player) => setPlayerDialog({ team, player })}
              onSetHome={() => void setHomeTeam(team.id)}
              onChanged={() => {
                reloadTeams();
                reloadSettings();
              }}
            />
          ))}
        </div>
      </section>

      {teamDialogTeam && (
        <TeamDialog
          team={teamDialogTeam === "new" ? null : teamDialogTeam}
          onClose={() => setTeamDialogTeam(null)}
          onSaved={() => {
            setTeamDialogTeam(null);
            reloadTeams();
            reloadSettings();
          }}
        />
      )}

      {playerDialog && (
        <PlayerDialog
          team={playerDialog.team}
          player={playerDialog.player === "new" ? null : playerDialog.player}
          onClose={() => setPlayerDialog(null)}
          onSaved={() => {
            setPlayerDialog(null);
            reloadTeams();
          }}
        />
      )}

      {rosterDialogTeam && (
        <RosterDialog
          team={rosterDialogTeam}
          onClose={() => setRosterDialogTeam(null)}
          onSaved={() => {
            setRosterDialogTeam(null);
            reloadTeams();
          }}
        />
      )}

      {visualsField && homeTeam && (
        <BulkVisualsDialog
          team={homeTeam}
          field={visualsField}
          onClose={() => setVisualsField(null)}
          onSaved={() => {
            setVisualsField(null);
            reloadTeams();
          }}
        />
      )}

      {matchDialog && teams && (
        <MatchDialog
          teams={teams}
          homeTeam={homeTeam}
          onClose={() => setMatchDialog(false)}
          onSaved={() => {
            setMatchDialog(false);
            reloadTeams();
            reloadMatches();
          }}
        />
      )}

      {scheduleMatch && (
        <MatchScheduleDialog
          match={scheduleMatch}
          onClose={() => setScheduleMatch(null)}
          onSaved={() => {
            setScheduleMatch(null);
            reloadMatches();
          }}
        />
      )}
    </div>
  );
}

function TeamCard({
  team,
  isHome,
  onEdit,
  onEditRoster,
  onEditPlayer,
  onSetHome,
  onChanged,
}: {
  team: Team;
  isHome: boolean;
  onEdit: () => void;
  onEditRoster: () => void;
  onEditPlayer: (p: Player) => void;
  onSetHome: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div
        className="p-3 flex items-center justify-between rounded-t-lg"
        style={{ background: team.primaryColor + "33" }}
      >
        <div className="flex items-center gap-3">
          {team.logoPath ? (
            <img
              src={mediaUrl(team.logoPath)}
              alt=""
              className="w-10 h-10 object-contain rounded"
            />
          ) : (
            <div
              className="w-10 h-10 rounded flex items-center justify-center text-sm font-bold"
              style={{ background: team.primaryColor }}
            >
              {team.shortName.slice(0, 2)}
            </div>
          )}
          <div>
            <div className="font-semibold">{team.name}</div>
            <div className="text-xs text-muted-foreground">
              {team.shortName} · {team.players?.length ?? 0} players
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={isHome ? "secondary" : "ghost"} onClick={onSetHome}>
            {isHome ? "Home team" : "Set home"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (
                !confirm(
                  "Team en alle spelers verwijderen? Wedstrijden waarin dit team speelt worden ook verwijderd.",
                )
              ) {
                return;
              }
              try {
                const res = await fetch(`/api/teams/${team.id}`, { method: "DELETE" });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                  toast({
                    title: "Team verwijderen mislukt",
                    description:
                      typeof body?.error === "string"
                        ? body.error
                        : res.statusText || `HTTP ${res.status}`,
                    variant: "error",
                  });
                  return;
                }
                toast({ title: "Team verwijderd", variant: "success" });
                onChanged();
              } catch (e) {
                toast({
                  title: "Team verwijderen mislukt",
                  description: e instanceof Error ? e.message : String(e),
                  variant: "error",
                });
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      <div className="p-3">
        {(team.players ?? []).length > 0 ? (
          <div className="grid grid-cols-3 gap-1 max-h-64 overflow-auto">
            {(team.players ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => onEditPlayer(p)}
                className="flex items-center gap-2 rounded border border-border p-2 text-left text-xs hover:bg-secondary"
                title="Foto en doelpuntenvideo instellen"
              >
                <span className="font-black w-6 text-right">#{p.number}</span>
                <span className="truncate">
                  {p.firstName} {p.lastName}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            Nog geen spelers.
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          className="w-full mt-2"
          onClick={onEditRoster}
        >
          Spelers bewerken
        </Button>
      </div>
    </div>
  );
}

function TeamDialog({
  team,
  onClose,
  onSaved,
}: {
  team: Team | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(team?.name ?? "");
  const [shortName, setShortName] = useState(team?.shortName ?? "");
  const [primaryColor, setPrimaryColor] = useState(team?.primaryColor ?? "#2563eb");
  const [secondaryColor, setSecondaryColor] = useState(
    team?.secondaryColor ?? "#ffffff",
  );
  const [logoPath, setLogoPath] = useState<string | null>(team?.logoPath ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    const trimmedName = name.trim();
    const trimmedShort = shortName.trim();
    if (!trimmedName || !trimmedShort) {
      toast({
        title: "Vul naam en korte naam in",
        variant: "error",
      });
      setSaving(false);
      return;
    }
    const body = {
      name: trimmedName,
      shortName: trimmedShort,
      primaryColor,
      secondaryColor,
      logoPath,
    };
    console.log("[team-save] start", { editing: !!team, body });
    try {
      const res = team
        ? await fetch(`/api/teams/${team.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/teams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      console.log("[team-save] response", res.status);
      if (!res.ok) {
        const errorText = await res.text();
        console.warn("[team-save] failed", errorText);
        toast({
          title: "Team opslaan mislukt",
          description: `${res.status}: ${errorText || "geen detail"}`,
          variant: "error",
        });
        return;
      }
      toast({
        title: team ? "Team bijgewerkt" : "Team aangemaakt",
        variant: "success",
      });
      onSaved();
    } catch (err) {
      console.error("[team-save] exception", err);
      toast({
        title: "Team opslaan mislukt (onverwachte fout)",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function onLogo(file?: File, localPath?: string) {
    if (localPath) {
      setLogoPath(localPath);
      return;
    }
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    setUploading(false);
    if (!r.ok) { toast({ title: "Upload failed", variant: "error" }); return; }
    const data = await r.json();
    setLogoPath(data.path);
  }

  async function onLogoElectron() {
    const paths = await selectFilesViaDialog({
      title: "Selecteer teamlogo",
      filters: [{ name: "Afbeelding", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
    });
    if (paths[0]) setLogoPath(paths[0]);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{team ? "Edit team" : "New team"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Short name (max 5)</Label>
            <Input
              value={shortName}
              maxLength={5}
              onChange={(e) => setShortName(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Primary color</Label>
              <div className="flex gap-2">
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                />
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-12 h-10 rounded border"
                />
              </div>
            </div>
            <div>
              <Label>Secondary color</Label>
              <div className="flex gap-2">
                <Input
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                />
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="w-12 h-10 rounded border"
                />
              </div>
            </div>
          </div>
          <div>
            <Label>Logo</Label>
            <div className="flex items-center gap-3 flex-wrap">
              {logoPath && (
                <img
                  src={mediaUrl(logoPath)}
                  alt=""
                  className="w-16 h-16 object-contain rounded border"
                />
              )}
              {isElectron ? (
                <Button variant="outline" size="sm" onClick={onLogoElectron}>
                  Kies bestand…
                </Button>
              ) : (
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogo(f); }}
                />
              )}
              {uploading && <span className="text-xs">Uploading...</span>}
              {logoPath && (
                <Button variant="ghost" size="sm" onClick={() => setLogoPath(null)}>
                  Verwijder
                </Button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Opslaan…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlayerDialog({
  team,
  player,
  onClose,
  onSaved,
}: {
  team: Team;
  player: Player | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [number, setNumber] = useState(String(player?.number ?? ""));
  const [firstName, setFirstName] = useState(player?.firstName ?? "");
  const [lastName, setLastName] = useState(player?.lastName ?? "");
  const [position, setPosition] = useState(player?.position ?? "MID");
  const [photoPath, setPhotoPath] = useState<string | null>(
    player?.photoPath ?? null,
  );
  const [lineupVideoPath, setLineupVideoPath] = useState<string | null>(
    player?.lineupVideoPath ?? null,
  );
  const [goalMediaId, setGoalMediaId] = useState<string | null>(
    player?.goalMediaId ?? null,
  );
  const [uploading, setUploading] = useState(false);
  const { data: allMedia } = useApi<MediaItem[]>("/api/media");
  const videoMedia = (allMedia ?? []).filter((m) => m.type === "VIDEO" && !m.hideFromLibrary);

  async function save() {
    const body = {
      number: Number(number),
      firstName,
      lastName,
      position,
      photoPath,
      lineupVideoPath,
      goalMediaId,
    };
    const res = player
      ? await fetch(`/api/players/${player.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/players", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, teamId: team.id }),
        });
    if (!res.ok) {
      toast({
        title: "Failed to save player",
        description: await res.text(),
        variant: "error",
      });
      return;
    }
    onSaved();
  }

  async function onPhoto(file?: File) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    setUploading(false);
    if (!r.ok) return;
    const data = await r.json();
    setPhotoPath(data.path);
  }

  async function onLineupVideoFile(file?: File) {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    setUploading(false);
    if (!r.ok) return;
    const data = await r.json();
    setLineupVideoPath(data.path);
  }

  async function onPhotoElectron() {
    const paths = await selectFilesViaDialog({
      title: "Selecteer spelerfoto",
      filters: [{ name: "Afbeelding", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (paths[0]) setPhotoPath(paths[0]);
  }

  async function onLineupVideoElectron() {
    const paths = await selectFilesViaDialog({
      title: "Selecteer opstelling-/lineup-video",
      filters: [{ name: "Video", extensions: ["mp4", "webm", "mov", "m4v"] }],
    });
    if (paths[0]) setLineupVideoPath(paths[0]);
  }

  async function del() {
    if (!player) return;
    if (!confirm("Delete player?")) return;
    await fetch(`/api/players/${player.id}`, { method: "DELETE" });
    onSaved();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {player ? "Edit player" : "New player"} · {team.name}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Number</Label>
              <Input
                type="number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div>
              <Label>Position</Label>
              <Select value={position} onChange={(e) => setPosition(e.target.value)}>
                <option value="GK">GK</option>
                <option value="DEF">DEF</option>
                <option value="MID">MID</option>
                <option value="FWD">FWD</option>
                <option value="COACH">COACH</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Foto</Label>
            <div className="text-[11px] text-muted-foreground mb-1">
              Gebruikt in het <strong className="text-foreground/90">grafische spelerintro-sjabloon</strong> (als er{" "}
              <em>geen</em> lineup-video is ingesteld).
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {photoPath && (
                <img
                  src={mediaUrl(photoPath)}
                  alt=""
                  className="w-16 h-20 object-cover rounded"
                />
              )}
              {isElectron ? (
                <Button variant="outline" size="sm" onClick={onPhotoElectron}>
                  Kies bestand…
                </Button>
              ) : (
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); }}
                />
              )}
              {uploading && <span className="text-xs">Uploading...</span>}
              {photoPath && (
                <Button variant="ghost" size="sm" onClick={() => setPhotoPath(null)}>
                  Verwijder
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label>Lineup-video (custom opstelling)</Label>
            <div className="text-[11px] text-muted-foreground mb-1">
              Fullscreen video tijdens <strong className="text-foreground/90">Spelerintro</strong> op het scherm. Gaat
              vóór het vaste sjabloon met foto/tekst. Zelfde bestanden kun je ook via Setup → map-import “Opstelling
              video’s…” koppelen.
            </div>
            <div className="flex flex-col gap-2">
              {lineupVideoPath ? (
                <video
                  src={mediaUrl(lineupVideoPath)}
                  muted
                  controls
                  className="w-full max-w-md rounded bg-black aspect-video"
                />
              ) : (
                <div className="text-xs text-muted-foreground italic">Nog geen lineup-video.</div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {isElectron ? (
                  <Button variant="outline" size="sm" type="button" onClick={() => void onLineupVideoElectron()}>
                    Video kiezen…
                  </Button>
                ) : (
                  <Input
                    type="file"
                    accept="video/*"
                    className="max-w-xs"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onLineupVideoFile(f);
                    }}
                  />
                )}
                {lineupVideoPath && (
                  <Button variant="ghost" size="sm" type="button" onClick={() => setLineupVideoPath(null)}>
                    Verwijder
                  </Button>
                )}
              </div>
              {!isElectron && (
                <div className="text-[10px] text-muted-foreground">
                  In de browser: upload een videobestand; in de desktop-app kun je direct een pad kiezen.
                </div>
              )}
            </div>
          </div>
          <div>
            <Label>Goal celebration video</Label>
            <div className="text-[11px] text-muted-foreground mb-1">
              Played fullscreen after this player is confirmed as the scorer.
              Upload videos in the Media tab first.
            </div>
            <Select
              value={goalMediaId ?? ""}
              onChange={(e) => setGoalMediaId(e.target.value || null)}
            >
              <option value="">— No personal video (text banner) —</option>
              {videoMedia.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} · {m.durationSec}s
                </option>
              ))}
            </Select>
            {goalMediaId && (
              <div className="mt-2 aspect-video bg-black rounded overflow-hidden max-w-xs">
                <video
                  key={goalMediaId}
                  src={videoMedia.find((m) => m.id === goalMediaId)?.path}
                  muted
                  className="w-full h-full object-cover"
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          {player && (
            <Button variant="destructive" onClick={del} className="mr-auto">
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type RosterRow = {
  rowId: string;
  id: string | null;
  number: string;
  firstName: string;
  lastName: string;
};

function makeEmptyRow(): RosterRow {
  return {
    rowId: Math.random().toString(36).slice(2),
    id: null,
    number: "",
    firstName: "",
    lastName: "",
  };
}

function RosterDialog({
  team,
  onClose,
  onSaved,
}: {
  team: Team;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialRows: RosterRow[] = (team.players ?? [])
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((p) => ({
      rowId: p.id,
      id: p.id,
      number: String(p.number),
      firstName: p.firstName,
      lastName: p.lastName,
    }));

  const [rows, setRows] = useState<RosterRow[]>(
    initialRows.length > 0
      ? [...initialRows, makeEmptyRow()]
      : Array.from({ length: 5 }, makeEmptyRow),
  );
  const [saving, setSaving] = useState(false);

  function updateRow(rowId: string, patch: Partial<RosterRow>) {
    setRows((current) => {
      const next = current.map((row) =>
        row.rowId === rowId ? { ...row, ...patch } : row,
      );
      const last = next[next.length - 1];
      const lastIsFilled =
        last && (last.number.trim() || last.firstName.trim() || last.lastName.trim());
      if (lastIsFilled) {
        return [...next, makeEmptyRow()];
      }
      return next;
    });
  }

  function removeRow(rowId: string) {
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      if (next.length === 0) return [makeEmptyRow()];
      return next;
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);

    try {
      const cleaned = rows
        .map((row) => ({
          ...row,
          number: row.number.trim(),
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
        }))
        .filter(
          (row) => row.number || row.firstName || row.lastName,
        );

      for (const row of cleaned) {
        if (!row.number) {
          toast({
            title: "Rugnummer ontbreekt",
            description: `Vul een nummer in voor ${row.firstName || row.lastName || "speler"}`,
            variant: "error",
          });
          return;
        }
        const num = Number(row.number);
        if (!Number.isFinite(num) || num < 0 || num > 999) {
          toast({
            title: `Ongeldig rugnummer: "${row.number}"`,
            variant: "error",
          });
          return;
        }
        if (!row.firstName && !row.lastName) {
          toast({
            title: `Naam ontbreekt bij #${row.number}`,
            variant: "error",
          });
          return;
        }
      }

      const numberSet = new Set<number>();
      for (const row of cleaned) {
        const num = Number(row.number);
        if (numberSet.has(num)) {
          toast({
            title: `Rugnummer ${num} komt meer dan één keer voor`,
            variant: "error",
          });
          return;
        }
        numberSet.add(num);
      }

      const originalIds = new Set(
        (team.players ?? []).map((p) => p.id),
      );
      const keptIds = new Set(
        cleaned.map((row) => row.id).filter((id): id is string => !!id),
      );

      for (const id of originalIds) {
        if (!keptIds.has(id)) {
          const res = await fetch(`/api/players/${id}`, { method: "DELETE" });
          if (!res.ok) {
            toast({
              title: "Speler verwijderen mislukt",
              description: await res.text(),
              variant: "error",
            });
            return;
          }
        }
      }

      for (const row of cleaned) {
        const body = {
          number: Number(row.number),
          firstName: row.firstName,
          lastName: row.lastName,
        };
        const res = row.id
          ? await fetch(`/api/players/${row.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch("/api/players", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...body, teamId: team.id, position: "MID" }),
            });
        if (!res.ok) {
          toast({
            title: `Speler opslaan mislukt (#${row.number})`,
            description: await res.text(),
            variant: "error",
          });
          return;
        }
      }

      toast({ title: "Spelers opgeslagen", variant: "success" });
      onSaved();
    } catch (err) {
      console.error("[roster-save] exception", err);
      toast({
        title: "Spelers opslaan mislukt",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Spelers · {team.name}</DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground mb-3">
          Vul de hele lijst onder elkaar in. Lege rijen worden genegeerd. Een
          extra lege rij verschijnt automatisch zodra je begint te typen.
        </div>

        <div className="grid grid-cols-[80px_1fr_1fr_40px] gap-2 text-xs font-semibold text-muted-foreground px-1 mb-1">
          <div>#</div>
          <div>Voornaam</div>
          <div>Achternaam</div>
          <div></div>
        </div>

        <div className="flex flex-col gap-1 max-h-[60vh] overflow-auto pr-1">
          {rows.map((row) => (
            <div
              key={row.rowId}
              className="grid grid-cols-[80px_1fr_1fr_40px] gap-2 items-center"
            >
              <Input
                type="number"
                inputMode="numeric"
                value={row.number}
                onChange={(e) => updateRow(row.rowId, { number: e.target.value })}
                placeholder="#"
              />
              <Input
                value={row.firstName}
                onChange={(e) => updateRow(row.rowId, { firstName: e.target.value })}
                placeholder="Voornaam"
              />
              <Input
                value={row.lastName}
                onChange={(e) => updateRow(row.rowId, { lastName: e.target.value })}
                placeholder="Achternaam"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeRow(row.rowId)}
                title="Rij verwijderen"
              >
                ×
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRows((current) => [...current, makeEmptyRow()])}
          >
            + Extra rij
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HomeVisualsSummary({ team }: { team: Team }) {
  const players = team.players ?? [];
  const counts = {
    goal: players.filter((p) => !!p.goalVideoPath).length,
    sub: players.filter((p) => !!p.subImagePath).length,
    lineup: players.filter((p) => !!p.lineupVideoPath).length,
  };
  const total = players.length;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
      <div>Goal: {counts.goal}/{total}</div>
      <div>Wissel: {counts.sub}/{total}</div>
      <div>Opstelling: {counts.lineup}/{total}</div>
    </div>
  );
}

function BulkVisualsDialog({
  team,
  field,
  onClose,
  onSaved,
}: {
  team: Team;
  field: VisualField;
  onClose: () => void;
  onSaved: () => void;
}) {
  const meta = VISUAL_LABELS[field];
  const players = (team.players ?? []).slice().sort((a, b) => a.number - b.number);

  const [files, setFiles] = useState<Array<{ name: string; path: string }>>([]);
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of players) {
      const current = p[field];
      if (current) initial[p.id] = current;
    }
    return initial;
  });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const assignedPaths = new Set(Object.values(assignments));

  async function pickFolder() {
    if (!isElectron) {
      toast({ title: "Alleen beschikbaar in de desktop-app", variant: "error" });
      return;
    }
    const result = await selectFolderViaDialog({
      title: `Kies map met ${meta.title.toLowerCase()}`,
      extensions: meta.extensions,
    });
    if (!result.folderPath) return;
    setFolderPath(result.folderPath);
    setFiles(result.files);
  }

  function assignToPlayer(playerId: string) {
    if (!selectedFile) {
      toast({
        title: "Selecteer eerst een bestand links",
        variant: "warning",
      });
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      for (const [pid, path] of Object.entries(next)) {
        if (path === selectedFile) delete next[pid];
      }
      next[playerId] = selectedFile;
      return next;
    });
    setSelectedFile(null);
  }

  function clearPlayer(playerId: string) {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        field,
        assignments: players.map((p) => ({
          playerId: p.id,
          filePath: assignments[p.id] ?? null,
        })),
      };
      const res = await fetch("/api/players/bulk-visuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast({
          title: "Opslaan mislukt",
          description: await res.text(),
          variant: "error",
        });
        return;
      }
      toast({ title: `${meta.title} opgeslagen`, variant: "success" });
      onSaved();
    } catch (err) {
      toast({
        title: "Opslaan mislukt",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const isVideo = field !== "subImagePath";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{meta.title} · {team.name}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-xs text-muted-foreground truncate">
            {folderPath ? (
              <>Map: <span className="font-mono">{folderPath}</span> · {files.length} bestand(en)</>
            ) : (
              <>Nog geen map gekozen.</>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={pickFolder}>
            {folderPath ? "Andere map kiezen…" : "Map kiezen…"}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4 max-h-[60vh]">
          <div className="flex flex-col rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-2 bg-secondary/40 text-xs font-semibold uppercase tracking-wide">
              Bestanden
            </div>
            <div className="flex-1 overflow-auto">
              {files.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground italic">
                  Kies hierboven een map om de inhoud te tonen.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {files.map((file) => {
                    const isSelected = selectedFile === file.path;
                    const isAssigned = assignedPaths.has(file.path);
                    return (
                      <li key={file.path}>
                        <button
                          type="button"
                          onClick={() => setSelectedFile(isSelected ? null : file.path)}
                          className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                            isSelected ? "bg-primary/20" : "hover:bg-secondary/40"
                          }`}
                        >
                          <span className="flex-1 truncate">{file.name}</span>
                          {isAssigned && (
                            <span className="text-[10px] rounded bg-green-500/20 text-green-400 px-1.5 py-0.5">
                              toegewezen
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-col rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-2 bg-secondary/40 text-xs font-semibold uppercase tracking-wide flex items-center justify-between">
              <span>Spelers</span>
              {selectedFile && (
                <span className="text-[10px] font-normal text-muted-foreground">
                  Klik een speler om toe te wijzen
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {players.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground italic">
                  Geen spelers in deze ploeg.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {players.map((p) => {
                    const assigned = assignments[p.id];
                    const fileName = assigned
                      ? assigned.split(/[\\/]/).pop()
                      : null;
                    return (
                      <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => assignToPlayer(p.id)}
                          disabled={!selectedFile}
                          className="flex-1 text-left text-xs flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <span className="font-black w-6 text-right">#{p.number}</span>
                          <span className="flex-1 truncate">
                            {p.firstName} {p.lastName}
                          </span>
                          {fileName ? (
                            <span className="text-[10px] rounded bg-primary/20 text-primary px-1.5 py-0.5 truncate max-w-[45%]">
                              {fileName}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </button>
                        {assigned && (
                          <button
                            type="button"
                            onClick={() => clearPlayer(p.id)}
                            className="text-muted-foreground hover:text-foreground text-xs"
                            title="Koppeling wissen"
                          >
                            ×
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {selectedFile && (
          <div className="mt-3 rounded-lg border border-border p-3 flex gap-3 items-center">
            {isVideo ? (
              <video
                src={mediaUrl(selectedFile)}
                muted
                controls
                className="h-24 rounded bg-black"
              />
            ) : (
              <img
                src={mediaUrl(selectedFile)}
                alt=""
                className="h-24 rounded bg-black object-contain"
              />
            )}
            <div className="text-xs flex-1 min-w-0">
              <div className="font-semibold truncate">
                {selectedFile.split(/[\\/]/).pop()}
              </div>
              <div className="text-muted-foreground break-all max-h-16 overflow-y-auto leading-snug">
                {selectedFile}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function shortNameFromName(name: string) {
  return name
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 5)
    .toUpperCase();
}

function localDatetimeToIso(local: string): string | null {
  if (!local?.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MatchDialog({
  teams,
  homeTeam,
  onClose,
  onSaved,
}: {
  teams: Team[];
  homeTeam: Team | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [sport, setSport] = useState<SportType>("FOOTBALL");
  const sportProfile = getSportProfile(sport);
  const [awayId, setAwayId] = useState(
    teams.find((team) => team.id !== homeTeam?.id)?.id ?? "",
  );
  const [awayName, setAwayName] = useState("");
  const [awayShortName, setAwayShortName] = useState("");
  const [awayLogoPath, setAwayLogoPath] = useState<string | null>(null);
  const [awayPrimaryColor, setAwayPrimaryColor] = useState("#111827");
  const [awaySecondaryColor, setAwaySecondaryColor] = useState("#ffffff");
  const [uploading, setUploading] = useState(false);
  const [kickoffLocal, setKickoffLocal] = useState("");
  const [matchSponsorMediaId, setMatchSponsorMediaId] = useState("");
  const { data: mediaForMatch } = useApi<MediaItem[]>("/api/media");

  async function onAwayLogo(file?: File, localPath?: string) {
    if (localPath) {
      setAwayLogoPath(localPath);
      return;
    }
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    setUploading(false);
    if (!res.ok) {
      toast({ title: "Upload failed", variant: "error" });
      return;
    }
    const data = await res.json();
    setAwayLogoPath(data.path);
  }

  async function onAwayLogoElectron() {
    const paths = await selectFilesViaDialog({
      title: "Selecteer away team-logo",
      filters: [{ name: "Afbeelding", extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
    });
    if (paths[0]) setAwayLogoPath(paths[0]);
  }

  async function ensureAwayTeamId() {
    if (!homeTeam) {
      toast({ title: "Stel eerst een vast home team in", variant: "error" });
      return null;
    }

    if (mode === "existing") {
      if (!awayId || awayId === homeTeam.id) {
        toast({ title: "Kies een ander away team", variant: "error" });
        return null;
      }
      return awayId;
    }

    const name = awayName.trim();
    if (!name) {
      toast({ title: "Vul een away teamnaam in", variant: "error" });
      return null;
    }
    const shortName = (awayShortName.trim() || shortNameFromName(name)).slice(0, 5);
    if (!shortName) {
      toast({ title: "Away team short name ontbreekt", variant: "error" });
      return null;
    }

    const teamRes = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        shortName,
        logoPath: awayLogoPath,
        primaryColor: awayPrimaryColor,
        secondaryColor: awaySecondaryColor,
      }),
    });
    if (!teamRes.ok) {
      toast({ title: "Away team aanmaken mislukt", variant: "error" });
      return null;
    }
    const created = (await teamRes.json()) as Team;
    return created.id;
  }

  async function save() {
    if (!homeTeam) {
      toast({ title: "Stel eerst een vast home team in", variant: "error" });
      return;
    }

    const resolvedAwayId = await ensureAwayTeamId();
    if (!resolvedAwayId) return;

    const payload: Record<string, unknown> = {
      homeTeamId: homeTeam.id,
      awayTeamId: resolvedAwayId,
      sport,
      periodDurationSec: sportProfile.defaultPeriodDurationSec,
      kickoffAt: kickoffLocal.trim() ? localDatetimeToIso(kickoffLocal) : null,
      matchSponsorMediaId: matchSponsorMediaId.trim() ? matchSponsorMediaId : null,
    };

    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      toast({ title: "Wedstrijd aanmaken mislukt", variant: "error" });
      return;
    }
    onSaved();
  }

  const selectableAwayTeams = teams.filter((team) => team.id !== homeTeam?.id);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New match</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border border-border p-3">
          <Label>Sport</Label>
          <Select
            value={sport}
            onChange={(event) => setSport(event.target.value as SportType)}
            className="mt-1"
          >
            {SPORT_TYPES.map((sportId) => (
              <option key={sportId} value={sportId}>
                {getSportProfile(sportId).label}
              </option>
            ))}
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">
            {sportProfile.periodCount} × {sportProfile.periodLabel.toLowerCase()}
            {sportProfile.timerMode === "NONE"
              ? " · zonder wedstrijdklok"
              : ` · ${Math.round(sportProfile.defaultPeriodDurationSec / 60)} minuten · ${
                  sportProfile.timerMode === "COUNT_DOWN" ? "aftellend" : "optellend"
                }`}
            {sportProfile.shotClockPresets.length > 0
              ? ` · shotclock ${sportProfile.shotClockPresets.join("/")}`
              : ""}
          </p>
        </div>
        {!homeTeam ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Stel eerst in de Setup-tab een vast home team in.
          </div>
        ) : (
          <div className="grid gap-4">
            <div>
              <Label>Home team</Label>
              <div className="mt-2 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                {homeTeam.logoPath ? (
                  <img
                    src={mediaUrl(homeTeam.logoPath)}
                    alt=""
                    className="h-12 w-12 rounded object-contain"
                  />
                ) : (
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded font-black"
                    style={{
                      background: homeTeam.primaryColor,
                      color: homeTeam.secondaryColor,
                    }}
                  >
                    {homeTeam.shortName.slice(0, 3)}
                  </div>
                )}
                <div>
                  <div className="font-semibold">{homeTeam.name}</div>
                  <div className="text-xs text-muted-foreground">{homeTeam.shortName}</div>
                </div>
              </div>
            </div>

            <div>
              <Label>Away team</Label>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "existing" ? "default" : "outline"}
                  onClick={() => setMode("existing")}
                >
                  Kies bestaand team
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "new" ? "default" : "outline"}
                  onClick={() => setMode("new")}
                >
                  Nieuw away team
                </Button>
              </div>
            </div>

            {mode === "existing" ? (
              <div>
                <Label>Selecteer away team</Label>
                <Select value={awayId} onChange={(e) => setAwayId(e.target.value)}>
                  <option value="">Kies team…</option>
                  {selectableAwayTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="grid gap-3">
                <div>
                  <Label>Away teamnaam</Label>
                  <Input
                    value={awayName}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setAwayName(nextName);
                      if (!awayShortName) {
                        setAwayShortName(shortNameFromName(nextName));
                      }
                    }}
                    placeholder="Bijv. Ajax"
                  />
                </div>
                <div>
                  <Label>Korte naam</Label>
                  <Input
                    value={awayShortName}
                    maxLength={5}
                    onChange={(e) => setAwayShortName(e.target.value.toUpperCase())}
                    placeholder="AJA"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Primary color</Label>
                    <div className="flex gap-2">
                      <Input
                        value={awayPrimaryColor}
                        onChange={(e) => setAwayPrimaryColor(e.target.value)}
                      />
                      <input
                        type="color"
                        value={awayPrimaryColor}
                        onChange={(e) => setAwayPrimaryColor(e.target.value)}
                        className="h-10 w-12 rounded border"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Secondary color</Label>
                    <div className="flex gap-2">
                      <Input
                        value={awaySecondaryColor}
                        onChange={(e) => setAwaySecondaryColor(e.target.value)}
                      />
                      <input
                        type="color"
                        value={awaySecondaryColor}
                        onChange={(e) => setAwaySecondaryColor(e.target.value)}
                        className="h-10 w-12 rounded border"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <Label>Logo</Label>
                  <div className="flex items-center gap-3 flex-wrap">
                    {awayLogoPath && (
                      <img
                        src={mediaUrl(awayLogoPath)}
                        alt=""
                        className="w-16 h-16 object-contain rounded border"
                      />
                    )}
                    {isElectron ? (
                      <Button variant="outline" size="sm" onClick={onAwayLogoElectron}>
                        Kies bestand…
                      </Button>
                    ) : (
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void onAwayLogo(file);
                        }}
                      />
                    )}
                    {uploading && <span className="text-xs">Uploading...</span>}
                    {awayLogoPath && (
                      <Button variant="ghost" size="sm" onClick={() => setAwayLogoPath(null)}>
                        Verwijder
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border p-3 space-y-3">
              <div className="text-sm font-semibold">Aftrap & matchsponsor (optioneel)</div>
              <div>
                <Label>Geplande aftrap</Label>
                <Input
                  type="datetime-local"
                  value={kickoffLocal}
                  onChange={(e) => setKickoffLocal(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Met matchsponsor: automatisch fullscreen vanaf{" "}
                  {PREMATCH_MATCH_SPONSOR_LEAD_MS / 60_000} min voor deze tijd tot de aftrap (alleen
                  SETUP/PREMATCH).
                </p>
              </div>
              <div>
                <Label>Matchsponsor-media</Label>
                <Select
                  value={matchSponsorMediaId}
                  onChange={(e) => setMatchSponsorMediaId(e.target.value)}
                  className="mt-1"
                >
                  <option value="">— geen —</option>
                  {(mediaForMatch ?? [])
                    .filter((it) => it.active && !it.hideFromLibrary)
                    .map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.title} ({it.type})
                      </option>
                    ))}
                </Select>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!homeTeam}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatPrematchSpreadWindowMinutes(sec?: number | null): string {
  const s = sec ?? 0;
  if (s <= 0) return "";
  return String(Math.max(1, Math.round(s / 60)));
}

/** Leeg = automatisch; anders seconden (60 … 24u), afgerond vanuit minuten. */
function parsePrematchWindowMinToSec(raw: string): number | "invalid" {
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  if (n === 0) return 0;
  const minutes = Math.min(24 * 60, Math.floor(n));
  return Math.max(60, minutes * 60);
}

function MatchScheduleDialog({
  match,
  onClose,
  onSaved,
}: {
  match: Match;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: mediaList } = useApi<MediaItem[]>("/api/media");
  const [kickoffLocal, setKickoffLocal] = useState(() => isoToDatetimeLocalValue(match.kickoffAt));
  const [sponsorId, setSponsorId] = useState(match.matchSponsorMediaId ?? "");
  const [prematchWindowMin, setPrematchWindowMin] = useState(() =>
    formatPrematchSpreadWindowMinutes(match.prematchSpreadWindowSec),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKickoffLocal(isoToDatetimeLocalValue(match.kickoffAt));
    setSponsorId(match.matchSponsorMediaId ?? "");
    setPrematchWindowMin(formatPrematchSpreadWindowMinutes(match.prematchSpreadWindowSec));
  }, [match.id, match.kickoffAt, match.matchSponsorMediaId, match.prematchSpreadWindowSec]);

  async function save() {
    setSaving(true);
    try {
      const prematchSec = parsePrematchWindowMinToSec(prematchWindowMin);
      if (prematchSec === "invalid") {
        toast({
          title: "Ongeldige prematch-duur",
          description: "Vul een niet-negatief geheel getal minuten in, of laat leeg voor automatisch.",
          variant: "error",
        });
        return;
      }
      const res = await fetch(`/api/matches/${match.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kickoffAt: kickoffLocal.trim() ? localDatetimeToIso(kickoffLocal) : null,
          matchSponsorMediaId: sponsorId.trim() ? sponsorId : null,
          prematchSpreadWindowSec: prematchSec,
        }),
      });
      if (!res.ok) {
        toast({ title: "Opslaan mislukt", description: await res.text(), variant: "error" });
        return;
      }
      toast({ title: "Opgeslagen", variant: "success" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aftrap, prematch-rooster & matchsponsor</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {match.homeTeam.name} <span className="text-muted-foreground/80">vs</span>{" "}
          {match.awayTeam.name}
        </p>
        <div className="grid gap-3 pt-2">
          <div>
            <Label>Geplande aftrap</Label>
            <Input
              type="datetime-local"
              value={kickoffLocal}
              onChange={(e) => setKickoffLocal(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leeg = geen geplande tijd. Met sponsor: vanaf {PREMATCH_MATCH_SPONSOR_LEAD_MS / 60_000}{" "}
              min ervoor tot deze tijd automatisch op het display (SETUP/PREMATCH).
            </p>
          </div>
          <div>
            <Label>Prematch: start sponsoring vóór aftrap (minuten)</Label>
            <Input
              type="number"
              min={0}
              max={1440}
              step={1}
              placeholder="Leeg = automatisch (som «voor»-seconden)"
              value={prematchWindowMin}
              onChange={(e) => setPrematchWindowMin(e.target.value)}
              className="mt-1 max-w-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Met een <strong>geplande aftrap</strong> start het sponsorrooster automatisch{" "}
              <strong>zoveel minuten vóór aftrap</strong> en eindigt op aftrap. De ingevulde
              sponsorseconden «Voor wedstrijd» (bv. 2 min) worden <strong>gespreid</strong> over dat
              venster — niet allemaal achter elkaar. Vul bv. <strong>30</strong> voor een halfuur
              prematch-spread; laat leeg om de som van de sponsor-budgetten als venster te gebruiken.
              Zonder aftrap: spread start wanneer je sponsorrotatie inschakelt (PREMATCH).
            </p>
          </div>
          <div>
            <Label>Matchsponsor-media</Label>
            <Select value={sponsorId} onChange={(e) => setSponsorId(e.target.value)} className="mt-1">
              <option value="">— geen —</option>
              {(mediaList ?? [])
                .filter((it) => it.active && !it.hideFromLibrary)
                .map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.title} ({it.type})
                  </option>
                ))}
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Sluiten
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
