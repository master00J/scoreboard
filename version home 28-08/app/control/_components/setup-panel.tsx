"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { normalizeUiLocale, type UiLocale } from "@/lib/i18n";
import { tMatchStatus } from "@/lib/i18n/t-phase";
import { SetupScoreboardTemplatesSection } from "./setup-scoreboard-templates";
import { SetupScoreboardThemeSection } from "./setup-scoreboard-theme";
import { SetupDisplayCanvasSection } from "./setup-display-canvas";
import { AssetHealthCheck } from "./asset-health-check";
import { getSportProfile, SPORT_TYPES, type SportType } from "@/lib/sports";

type VisualField = "goalVideoPath" | "subImagePath" | "lineupVideoPath";

export function SetupPanel() {
  const { t, i18n } = useTranslation();
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

  async function setUiLocale(next: UiLocale) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uiLocale: next }),
    });
    if (!res.ok) {
      toast({ title: t("language.saveFailed"), variant: "error" });
      return;
    }
    await i18n.changeLanguage(next);
    window.dispatchEvent(new CustomEvent("arenacue:ui-locale", { detail: next }));
    toast({ title: t("language.saved"), variant: "success" });
    reloadSettings();
  }

  async function setHomeTeam(teamId: string | null) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ homeTeamId: teamId }),
    });
    if (!res.ok) {
      toast({ title: t("setup.homeTeamSaveFailed"), variant: "error" });
      return;
    }
    reloadSettings();
  }

  async function pickGoalIntroVideo() {
    const paths = await selectFilesViaDialog({
      title: t("setup.goalIntroPick"),
      filters: [{ name: t("setup.filterVideo"), extensions: ["mp4", "webm", "mov", "m4v"] }],
    });
    if (paths.length === 0) return;
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalIntroVideoPath: paths[0] }),
    });
    if (!res.ok) {
      toast({
        title: t("setup.goalIntroSaveFailed"),
        description: await res.text(),
        variant: "error",
      });
      return;
    }
    toast({ title: t("setup.goalIntroSaved"), variant: "success" });
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
      toast({ title: t("setup.goalVisualSaveFailed"), variant: "error" });
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
      toast({ title: t("setup.idleMediaSaveFailed"), variant: "error" });
      return;
    }
    reloadSettings();
  }

  const currentLocale = normalizeUiLocale(settings?.uiLocale ?? i18n.language);

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-1">{t("language.title")}</h2>
        <p className="text-sm text-muted-foreground mb-3">{t("language.description")}</p>
        <Label htmlFor="ui-locale">{t("language.label")}</Label>
        <Select
          id="ui-locale"
          className="mt-2 max-w-xs"
          value={currentLocale}
          onChange={(event) => void setUiLocale(normalizeUiLocale(event.target.value))}
        >
          <option value="nl">{t("language.nl")}</option>
          <option value="en">{t("language.en")}</option>
          <option value="fr">{t("language.fr")}</option>
        </Select>
      </section>
      {isElectron ? (
        <section className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-1">{t("setup.venueBackupTitle")}</h2>
          <p className="text-sm text-muted-foreground mb-3">{t("setup.venueBackupBody")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void (async () => {
                const r = await exportVenueBackup();
                if (r.canceled) return;
                if (!r.ok) {
                  toast({ title: t("setup.backupFailed"), description: r.error ?? "", variant: "error" });
                  return;
                }
                toast({
                  title: t("setup.backupSaved"),
                  description: r.filePath ?? "",
                  variant: "success",
                });
              })();
            }}
          >
            {t("setup.exportBackup")}
          </Button>
        </section>
      ) : null}
      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4 gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t("setup.homeTeamTitle")}</h2>
            <div className="text-sm text-muted-foreground">{t("setup.homeTeamBody")}</div>
          </div>
          {homeTeam && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setTeamDialogTeam(homeTeam)}>
                {t("common.edit")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void setHomeTeam(null)}>
                {t("setup.clearHomeTeam")}
              </Button>
            </div>
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
                <div className="text-sm text-muted-foreground">
                  {homeTeam.shortName} · {t("common.playersCount", { count: homeTeam.players?.length ?? 0 })}
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{t("setup.goalIntroTitle")}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("setup.goalIntroBody")}
                    </div>
                  </div>
                  {settings?.goalIntroVideoPath && (
                    <Button variant="ghost" size="sm" onClick={clearGoalIntroVideo}>
                      {t("setup.clear")}
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
                    {t("setup.noVideoSet")}
                  </div>
                )}
                <Button size="sm" variant="outline" className="mt-3" onClick={pickGoalIntroVideo}>
                  {settings?.goalIntroVideoPath ? t("setup.replaceVideo") : t("setup.chooseVideo")}
                </Button>
                <div className="mt-4 border-t border-border pt-3">
                  <div className="font-semibold text-sm">{t("setup.goalPlusBehavior")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t("setup.goalPlusBehaviorBody")}
                  </div>
                  <div className="mt-3 grid gap-2">
                    <label className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-xs">
                      <span>{t("setup.goalVisualHome")}</span>
                      <input
                        type="checkbox"
                        checked={settings?.goalVisualHomeEnabled ?? true}
                        onChange={(e) => void setGoalVisualEnabled("home", e.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-xs">
                      <span>{t("setup.goalVisualAway")}</span>
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
                <div className="font-semibold mb-1">{t("setup.importVisualsTitle")}</div>
                <div className="text-xs text-muted-foreground mb-3">
                  {t("setup.importVisualsBody")}
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="outline" onClick={() => setVisualsField("goalVideoPath")}>
                    {t("setup.goalVideos")}…
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setVisualsField("subImagePath")}>
                    {t("setup.subImages")}…
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setVisualsField("lineupVideoPath")}>
                    {t("setup.lineupVideos")}…
                  </Button>
                </div>
                <HomeVisualsSummary team={homeTeam} />
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-border p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{t("setup.homeTeamPlayersTitle")}</div>
                  <div className="text-xs text-muted-foreground">{t("setup.homeTeamPlayersHelp")}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setRosterDialogTeam(homeTeam)}>
                  {t("setup.editPlayers")}
                </Button>
              </div>
              {(homeTeam.players ?? []).length > 0 ? (
                <div className="grid grid-cols-2 gap-1 max-h-80 overflow-auto sm:grid-cols-3">
                  {(homeTeam.players ?? []).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPlayerDialog({ team: homeTeam, player: p })}
                      className="flex items-center gap-2 rounded border border-border p-2 text-left text-xs hover:bg-secondary"
                      title={t("setup.playerVisualsHint")}
                    >
                      <span className="w-6 text-right font-black">#{p.number}</span>
                      <span className="truncate">
                        {p.firstName} {p.lastName}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-xs italic text-muted-foreground">{t("setup.noPlayersYet")}</div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4">
            <div className="mb-3 text-sm font-medium">{t("setup.homeTeamPick")}</div>
            {(teams ?? []).length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {(teams ?? []).map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => void setHomeTeam(team.id)}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-secondary"
                  >
                    {team.logoPath ? (
                      <img src={mediaUrl(team.logoPath)} alt="" className="h-10 w-10 rounded object-contain" />
                    ) : (
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded text-sm font-bold"
                        style={{ background: team.primaryColor }}
                      >
                        {team.shortName.slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{team.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("common.playersCount", { count: team.players?.length ?? 0 })}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-sm text-muted-foreground">{t("setup.setHomeHint")}</div>
                <Button size="sm" onClick={() => setTeamDialogTeam("new")}>
                  {t("setup.newTeam")}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-1">{t("setup.idleTitle")}</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-2xl">
          {t("setup.idleBody")}
        </p>
        <div className="max-w-xl space-y-2">
          <Label htmlFor="idle-fallback-media">{t("setup.idleFallbackLabel")}</Label>
          <Select
            id="idle-fallback-media"
            value={settings?.idleFallbackMediaId ?? ""}
            onChange={(e) =>
              void setIdleFallbackMedia(e.target.value === "" ? null : e.target.value)
            }
          >
            <option value="">{t("setup.idleFallbackNone")}</option>
            {(idleFallbackPickMedia ?? [])
              .filter((m) => !m.hideFromLibrary && m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.type === "VIDEO" ? t("setup.mediaTypeVideo") : t("setup.mediaTypeImage")})
                </option>
              ))}
          </Select>
        </div>
      </section>

      <SetupScoreboardTemplatesSection settings={settings} reloadSettings={reloadSettings} />
      <SetupScoreboardThemeSection
        settings={settings}
        reloadSettings={reloadSettings}
        homeTeam={homeTeam}
        awayTeam={(teams ?? []).find((team) => team.id !== homeTeam?.id) ?? null}
      />

      <SetupDisplayCanvasSection settings={settings ?? null} reloadSettings={reloadSettings} />

      <section className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-3">{t("setup.prematchCheck")}</h2>
        <AssetHealthCheck />
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t("setup.matches")}</h2>
          <Button onClick={() => setMatchDialog(true)}>{t("setup.newMatch")}</Button>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground max-w-3xl">
            {t("setup.matchesHelp")}
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
                <div className="text-muted-foreground text-sm">{t("common.vs")}</div>
                <div className="font-semibold">{m.awayTeam.name}</div>
                <span className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  {getSportProfile(m.sport).label}
                </span>
                {m.closedAt ? (
                  <span className="text-[10px] uppercase tracking-wide rounded px-2 py-0.5 bg-muted text-muted-foreground border border-border">
                    {t("setup.matchClosed")}
                  </span>
                ) : null}
                <div className="text-xs text-muted-foreground ml-2">
                  {m.homeScore} – {m.awayScore} · {tMatchStatus(t, m.status)}
                  {m.kickoffAt ? (
                    <>
                      {" "}
                      · {t("setup.kickoff").toLowerCase()}{" "}
                      {new Date(m.kickoffAt).toLocaleString(i18n.language, {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </>
                  ) : null}
                  {m.matchSponsorMediaId ? ` · ${t("common.matchSponsorTag")}` : ""}
                  {m.closedAt ? (
                    <>
                      {" "}
                      · {t("setup.matchClosed").toLowerCase()}{" "}
                      {new Date(m.closedAt).toLocaleString(i18n.language, {
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
                  {t("setup.kickoff")}
                </Button>
                {state?.matchId === m.id ? (
                  <Button variant="secondary" disabled size="sm">
                    {t("common.active")}
                  </Button>
                ) : m.closedAt ? (
                  <Button variant="secondary" disabled size="sm" title={t("setup.activateClosedTitle")}>
                    {t("setup.activate")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      sendCommand({ type: "match:setActive", matchId: m.id })
                    }
                  >
                    {t("setup.activate")}
                  </Button>
                )}
                {!m.closedAt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (
                        !confirm(
                          t("setup.closeMatchConfirm", {
                            home: m.homeTeam.name,
                            away: m.awayTeam.name,
                          }),
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
                          title: t("setup.closeMatchFailed"),
                          description: await res.text(),
                          variant: "error",
                        });
                        return;
                      }
                      toast({ title: t("setup.matchClosed"), variant: "success" });
                      reloadMatches();
                    }}
                  >
                    {t("setup.closeMatch")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (
                        !confirm(
                          t("setup.reopenMatchConfirm", {
                            home: m.homeTeam.name,
                            away: m.awayTeam.name,
                          }),
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
                          title: t("setup.reopenMatchFailed"),
                          description: await res.text(),
                          variant: "error",
                        });
                        return;
                      }
                      toast({ title: t("setup.matchReopened"), variant: "success" });
                      reloadMatches();
                    }}
                  >
                    {t("setup.reopen")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(t("setup.deleteMatchConfirm"))) return;
                    await fetch(`/api/matches/${m.id}`, { method: "DELETE" });
                    reloadMatches();
                  }}
                >
                  {t("common.delete")}
                </Button>
              </div>
            </div>
          ))}
          {matches?.length === 0 && (
            <div className="text-sm text-muted-foreground">{t("setup.noMatchesYet")}</div>
          )}
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{t("setup.otherTeamsTitle")}</h2>
            <div className="text-sm text-muted-foreground">{t("setup.otherTeamsBody")}</div>
          </div>
          <Button onClick={() => setTeamDialogTeam("new")}>{t("setup.newTeam")}</Button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(teams ?? [])
            .filter((team) => team.id !== settings?.homeTeamId)
            .map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                isHome={false}
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
  const { t } = useTranslation();
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
              {team.shortName} · {t("common.playersCount", { count: team.players?.length ?? 0 })}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={isHome ? "secondary" : "ghost"} onClick={onSetHome}>
            {isHome ? t("setup.homeTeamBadge") : t("setup.setHome")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {t("common.edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!confirm(t("setup.deleteTeamConfirm"))) {
                return;
              }
              try {
                const res = await fetch(`/api/teams/${team.id}`, { method: "DELETE" });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) {
                  toast({
                    title: t("setup.deleteTeamFailed"),
                    description:
                      typeof body?.error === "string"
                        ? body.error
                        : res.statusText || `HTTP ${res.status}`,
                    variant: "error",
                  });
                  return;
                }
                toast({ title: t("setup.teamDeleted"), variant: "success" });
                onChanged();
              } catch (e) {
                toast({
                  title: t("setup.deleteTeamFailed"),
                  description: e instanceof Error ? e.message : String(e),
                  variant: "error",
                });
              }
            }}
          >
            {t("common.delete")}
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
                title={t("setup.playerVisualsHint")}
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
            {t("setup.noPlayersYet")}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          className="w-full mt-2"
          onClick={onEditRoster}
        >
          {t("setup.editPlayers")}
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
  const { t } = useTranslation();
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
        title: t("setup.fillNameAndShort"),
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
          title: t("setup.teamSaveFailed"),
          description: `${res.status}: ${errorText || t("setup.noDetail")}`,
          variant: "error",
        });
        return;
      }
      toast({
        title: team ? t("setup.teamUpdated") : t("setup.teamCreated"),
        variant: "success",
      });
      onSaved();
    } catch (err) {
      console.error("[team-save] exception", err);
      toast({
        title: t("setup.teamSaveFailedUnexpected"),
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
    if (!r.ok) { toast({ title: t("setup.uploadFailed"), variant: "error" }); return; }
    const data = await r.json();
    setLogoPath(data.path);
  }

  async function onLogoElectron() {
    const paths = await selectFilesViaDialog({
      title: t("setup.selectTeamLogo"),
      filters: [{ name: t("setup.filterImage"), extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
    });
    if (paths[0]) setLogoPath(paths[0]);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{team ? t("common.edit") : t("setup.newTeam")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label>{t("setup.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>{t("setup.shortName")}</Label>
            <Input
              value={shortName}
              maxLength={5}
              onChange={(e) => setShortName(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("setup.primaryColor")}</Label>
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
              <Label>{t("setup.secondaryColor")}</Label>
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
            <Label>{t("setup.logo")}</Label>
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
                  {t("common.chooseFile")}
                </Button>
              ) : (
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogo(f); }}
                />
              )}
              {uploading && <span className="text-xs">{t("common.loading")}</span>}
              {logoPath && (
                <Button variant="ghost" size="sm" onClick={() => setLogoPath(null)}>
                  {t("common.remove")}
                </Button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t("common.loading") : t("common.save")}
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
  const { t } = useTranslation();
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
        title: t("setup.playerSaveFailed"),
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
      title: t("setup.selectPlayerPhoto"),
      filters: [{ name: t("setup.filterImage"), extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (paths[0]) setPhotoPath(paths[0]);
  }

  async function onLineupVideoElectron() {
    const paths = await selectFilesViaDialog({
      title: t("setup.selectLineupVideo"),
      filters: [{ name: t("setup.filterVideo"), extensions: ["mp4", "webm", "mov", "m4v"] }],
    });
    if (paths[0]) setLineupVideoPath(paths[0]);
  }

  async function del() {
    if (!player) return;
    if (!confirm(t("setup.deletePlayerConfirm"))) return;
    await fetch(`/api/players/${player.id}`, { method: "DELETE" });
    onSaved();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {player ? t("setup.editPlayer") : t("setup.newPlayer")} · {team.name}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>{t("setup.number")}</Label>
              <Input
                type="number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div>
              <Label>{t("setup.position")}</Label>
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
              <Label>{t("setup.firstName")}</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label>{t("setup.lastName")}</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>{t("setup.photo")}</Label>
            <div className="text-[11px] text-muted-foreground mb-1">
              {t("setup.photoHelpBefore")}{" "}
              <strong className="text-foreground/90">{t("setup.photoHelpStrong")}</strong>{" "}
              {t("setup.photoHelpAfter")}
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
                  {t("common.chooseFile")}
                </Button>
              ) : (
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); }}
                />
              )}
              {uploading && <span className="text-xs">{t("common.loading")}</span>}
              {photoPath && (
                <Button variant="ghost" size="sm" onClick={() => setPhotoPath(null)}>
                  {t("common.remove")}
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label>{t("setup.lineupVideo")}</Label>
            <div className="text-[11px] text-muted-foreground mb-1">
              {t("setup.lineupVideoHelp")}
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
                <div className="text-xs text-muted-foreground italic">{t("setup.noLineupVideo")}</div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {isElectron ? (
                  <Button variant="outline" size="sm" type="button" onClick={() => void onLineupVideoElectron()}>
                    {t("setup.chooseVideo")}
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
                    {t("common.remove")}
                  </Button>
                )}
              </div>
              {!isElectron && (
                <div className="text-[10px] text-muted-foreground">
                  {t("setup.lineupBrowserHint")}
                </div>
              )}
            </div>
          </div>
          <div>
            <Label>{t("setup.goalCelebrationVideo")}</Label>
            <div className="text-[11px] text-muted-foreground mb-1">
              {t("setup.goalCelebrationHelp")}
            </div>
            <Select
              value={goalMediaId ?? ""}
              onChange={(e) => setGoalMediaId(e.target.value || null)}
            >
              <option value="">{t("setup.noPersonalVideo")}</option>
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
              {t("common.delete")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save}>{t("common.save")}</Button>
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
  const { t } = useTranslation();
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
            title: t("setup.rosterMissingNumber"),
            description: t("setup.rosterMissingNumberDesc", {
              name: row.firstName || row.lastName || t("setup.rosterPlayerFallback"),
            }),
            variant: "error",
          });
          return;
        }
        const num = Number(row.number);
        if (!Number.isFinite(num) || num < 0 || num > 999) {
          toast({
            title: t("setup.rosterInvalidNumber", { number: row.number }),
            variant: "error",
          });
          return;
        }
        if (!row.firstName && !row.lastName) {
          toast({
            title: t("setup.rosterMissingName", { number: row.number }),
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
            title: t("setup.rosterDuplicateNumber", { number: num }),
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
              title: t("setup.playerDeleteFailed"),
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
            title: t("setup.playerSaveFailedNumber", { number: row.number }),
            description: await res.text(),
            variant: "error",
          });
          return;
        }
      }

      toast({ title: t("setup.playersSaved"), variant: "success" });
      onSaved();
    } catch (err) {
      console.error("[roster-save] exception", err);
      toast({
        title: t("setup.playersSaveFailed"),
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
          <DialogTitle>{t("setup.rosterTitle", { team: team.name })}</DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground mb-3">
          {t("setup.rosterHelp")}
        </div>

        <div className="grid grid-cols-[80px_1fr_1fr_40px] gap-2 text-xs font-semibold text-muted-foreground px-1 mb-1">
          <div>#</div>
          <div>{t("setup.firstName")}</div>
          <div>{t("setup.lastName")}</div>
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
                placeholder={t("setup.firstName")}
              />
              <Input
                value={row.lastName}
                onChange={(e) => updateRow(row.rowId, { lastName: e.target.value })}
                placeholder={t("setup.lastName")}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeRow(row.rowId)}
                title={t("setup.removeRow")}
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
            {t("setup.extraRow")}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HomeVisualsSummary({ team }: { team: Team }) {
  const { t } = useTranslation();
  const players = team.players ?? [];
  const counts = {
    goal: players.filter((p) => !!p.goalVideoPath).length,
    sub: players.filter((p) => !!p.subImagePath).length,
    lineup: players.filter((p) => !!p.lineupVideoPath).length,
  };
  const total = players.length;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
      <div>{t("setup.visualsGoal", { count: counts.goal, total })}</div>
      <div>{t("setup.visualsSub", { count: counts.sub, total })}</div>
      <div>{t("setup.visualsLineup", { count: counts.lineup, total })}</div>
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
  const { t } = useTranslation();
  const fieldMetaByKey: Record<VisualField, { title: string; extensions: string[] }> = {
    goalVideoPath: {
      title: t("setup.goalVideos"),
      extensions: ["mp4", "webm", "mov", "m4v"],
    },
    subImagePath: {
      title: t("setup.subImages"),
      extensions: ["png", "jpg", "jpeg", "webp"],
    },
    lineupVideoPath: {
      title: t("setup.lineupVideos"),
      extensions: ["mp4", "webm", "mov", "m4v"],
    },
  };
  const meta = fieldMetaByKey[field];
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
      toast({ title: t("setup.desktopOnly"), variant: "error" });
      return;
    }
    const result = await selectFolderViaDialog({
      title: t("setup.chooseFolderWith", { title: meta.title.toLowerCase() }),
      extensions: meta.extensions,
    });
    if (!result.folderPath) return;
    setFolderPath(result.folderPath);
    setFiles(result.files);
  }

  function assignToPlayer(playerId: string) {
    if (!selectedFile) {
      toast({
        title: t("setup.selectFileFirst"),
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
          title: t("setup.saveFailed"),
          description: await res.text(),
          variant: "error",
        });
        return;
      }
      toast({ title: t("setup.savedWithTitle", { title: meta.title }), variant: "success" });
      onSaved();
    } catch (err) {
      toast({
        title: t("setup.saveFailed"),
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
      <DialogContent size="xl" className="flex max-h-[90vh] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{meta.title} · {team.name}</DialogTitle>
        </DialogHeader>

        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <div className="truncate text-xs text-muted-foreground">
            {folderPath ? (
              <span className="font-mono">
                {t("setup.folderLabel", { path: folderPath, count: files.length })}
              </span>
            ) : (
              <>{t("setup.noFolderYet")}</>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={pickFolder}>
            {folderPath ? t("setup.chooseOtherFolder") : t("setup.chooseFolder")}
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
            <div className="px-3 py-2 bg-secondary/40 text-xs font-semibold uppercase tracking-wide">
              {t("setup.files")}
            </div>
            <div className="flex-1 overflow-auto">
              {files.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground italic">
                  {t("setup.chooseFolderHint")}
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
                              {t("setup.assigned")}
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

          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between bg-secondary/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide">
              <span>{t("setup.players")}</span>
              {selectedFile && (
                <span className="text-[10px] font-normal text-muted-foreground">
                  {t("setup.clickPlayerToAssign")}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {players.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground italic">
                  {t("setup.noPlayersInTeam")}
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
                            title={t("setup.clearAssignment")}
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
          <div className="mt-3 flex shrink-0 items-center gap-3 rounded-lg border border-border p-3">
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
              <div className="max-h-16 overflow-y-auto break-all leading-snug text-muted-foreground">
                {selectedFile}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="relative z-10 mt-4 shrink-0 border-t border-border bg-card pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
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

export type MatchDialogStartOptions = {
  /** Wedstrijd meteen actief zetten (PREMATCH). */
  activate: boolean;
  /** Na activeren modus SPONSOR_ROTATION (anders MATCH). */
  sponsorRotation: boolean;
};

export function MatchDialog({
  teams,
  homeTeam,
  onClose,
  onSaved,
  quickStart = false,
}: {
  teams: Team[];
  homeTeam: Team | null;
  onClose: () => void;
  onSaved: (match?: Match, start?: MatchDialogStartOptions) => void;
  /** Quick menu: zelfde schedule-velden als Setup + opties om direct te starten. */
  quickStart?: boolean;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
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
  const [prematchWindowMin, setPrematchWindowMin] = useState("");
  const [activateAfterCreate, setActivateAfterCreate] = useState(true);
  const [startSponsorRotation, setStartSponsorRotation] = useState(true);
  const { data: mediaForMatch } = useApi<MediaItem[]>("/api/media");
  const sponsorMediaAvailable = (mediaForMatch ?? []).some(
    (item) => item.active && !item.hideFromLibrary && !!item.sponsorId,
  );

  useEffect(() => {
    if (quickStart && mediaForMatch && !sponsorMediaAvailable) {
      setStartSponsorRotation(false);
    }
  }, [mediaForMatch, quickStart, sponsorMediaAvailable]);

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
      toast({ title: t("setup.uploadFailed"), variant: "error" });
      return;
    }
    const data = await res.json();
    setAwayLogoPath(data.path);
  }

  async function onAwayLogoElectron() {
    const paths = await selectFilesViaDialog({
      title: t("setup.selectAwayLogo"),
      filters: [{ name: t("setup.filterImage"), extensions: ["png", "jpg", "jpeg", "webp", "svg"] }],
    });
    if (paths[0]) setAwayLogoPath(paths[0]);
  }

  async function ensureAwayTeamId() {
    if (!homeTeam) {
      toast({ title: t("setup.setHomeFirst"), variant: "error" });
      return null;
    }

    if (mode === "existing") {
      if (!awayId || awayId === homeTeam.id) {
        toast({ title: t("setup.chooseOtherAway"), variant: "error" });
        return null;
      }
      return awayId;
    }

    const name = awayName.trim();
    if (!name) {
      toast({ title: t("setup.fillAwayName"), variant: "error" });
      return null;
    }
    const shortName = (awayShortName.trim() || shortNameFromName(name)).slice(0, 5);
    if (!shortName) {
      toast({ title: t("setup.awayShortMissing"), variant: "error" });
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
      toast({ title: t("setup.createAwayFailed"), variant: "error" });
      return null;
    }
    const created = (await teamRes.json()) as Team;
    return created.id;
  }

  function continueToOptions() {
    if (!homeTeam) {
      toast({ title: t("setup.setHomeFirst"), variant: "error" });
      return;
    }
    if (mode === "existing" && (!awayId || awayId === homeTeam.id)) {
      toast({ title: t("setup.chooseOtherAway"), variant: "error" });
      return;
    }
    if (mode === "new" && !awayName.trim()) {
      toast({ title: t("setup.fillAwayName"), variant: "error" });
      return;
    }
    setStep(2);
  }

  async function save() {
    if (!homeTeam) {
      toast({ title: t("setup.setHomeFirst"), variant: "error" });
      return;
    }

    const resolvedAwayId = await ensureAwayTeamId();
    if (!resolvedAwayId) return;

    const prematchSec = parsePrematchWindowMinToSec(prematchWindowMin);
    if (prematchSec === "invalid") {
      toast({
        title: t("setup.scheduleInvalidPrematch"),
        description: t("setup.scheduleInvalidPrematchDesc"),
        variant: "error",
      });
      return;
    }

    const payload: Record<string, unknown> = {
      homeTeamId: homeTeam.id,
      awayTeamId: resolvedAwayId,
      sport,
      periodDurationSec: sportProfile.defaultPeriodDurationSec,
      kickoffAt: kickoffLocal.trim() ? localDatetimeToIso(kickoffLocal) : null,
      matchSponsorMediaId: matchSponsorMediaId.trim() ? matchSponsorMediaId : null,
      prematchSpreadWindowSec: prematchSec,
    };

    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      toast({ title: t("setup.createMatchFailed"), variant: "error" });
      return;
    }
    const created = (await res.json()) as Match;
    onSaved(
      created,
      quickStart
        ? {
            activate: activateAfterCreate,
            sponsorRotation: activateAfterCreate && startSponsorRotation,
          }
        : undefined,
    );
  }

  const selectableAwayTeams = teams.filter((team) => team.id !== homeTeam?.id);
  const selectedAwayTeam = selectableAwayTeams.find((team) => team.id === awayId) ?? null;
  const awayTeamLabel = mode === "new" ? awayName.trim() : selectedAwayTeam?.name;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent size={quickStart ? "lg" : "md"}>
        <DialogHeader>
          <DialogTitle>{quickStart ? t("shell.startNewMatch") : t("setup.newMatch")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2" aria-label={t("setup.matchWizardProgress")}>
          <button
            type="button"
            onClick={() => setStep(1)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              step === 1
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-muted/20 text-muted-foreground"
            }`}
          >
            <span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-primary text-[11px] font-black text-primary-foreground">1</span>
            {t("setup.matchWizardTeams")}
          </button>
          <button
            type="button"
            onClick={() => step === 2 && setStep(2)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              step === 2
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-muted/20 text-muted-foreground"
            }`}
          >
            <span className="mr-2 inline-grid size-5 place-items-center rounded-full bg-secondary text-[11px] font-black text-foreground">2</span>
            {t("setup.matchWizardStart")}
          </button>
        </div>
        <div hidden={step !== 1} className="rounded-lg border border-border p-3">
          <Label>{t("setup.sport")}</Label>
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
              ? ` · ${t("setup.noClock")}`
              : ` · ${Math.round(sportProfile.defaultPeriodDurationSec / 60)} ${t("common.minutes")} · ${
                  sportProfile.timerMode === "COUNT_DOWN" ? t("setup.countDown") : t("setup.countUp")
                }`}
            {sportProfile.shotClockPresets.length > 0
              ? ` · ${t("setup.shotclock", { presets: sportProfile.shotClockPresets.join("/") })}`
              : ""}
          </p>
        </div>
        {!homeTeam ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("setup.setHomeFirst")}
          </div>
        ) : (
          <div className="grid gap-4">
            <div hidden={step !== 1}>
              <Label>{t("setup.homeTeam")}</Label>
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

            <div hidden={step !== 1}>
              <Label>{t("setup.awayTeam")}</Label>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "existing" ? "default" : "outline"}
                  onClick={() => setMode("existing")}
                >
                  {t("setup.chooseExisting")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "new" ? "default" : "outline"}
                  onClick={() => setMode("new")}
                >
                  {t("setup.newAwayTeam")}
                </Button>
              </div>
            </div>

            {mode === "existing" ? (
              <div hidden={step !== 1}>
                <Label>{t("setup.selectAway")}</Label>
                <Select value={awayId} onChange={(e) => setAwayId(e.target.value)}>
                  <option value="">{t("setup.chooseTeam")}</option>
                  {selectableAwayTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div hidden={step !== 1} className="grid gap-3">
                <div>
                  <Label>{t("setup.awayTeam")}</Label>
                  <Input
                    value={awayName}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setAwayName(nextName);
                      if (!awayShortName) {
                        setAwayShortName(shortNameFromName(nextName));
                      }
                    }}
                    placeholder={t("setup.awayNamePlaceholder")}
                  />
                </div>
                <div>
                  <Label>{t("setup.shortName")}</Label>
                  <Input
                    value={awayShortName}
                    maxLength={5}
                    onChange={(e) => setAwayShortName(e.target.value.toUpperCase())}
                    placeholder="AJA"
                  />
                </div>
                <details className="group rounded-lg border border-border p-3">
                  <summary className="cursor-pointer list-none text-sm font-medium">
                    {t("setup.optionalTeamStyle")}
                  </summary>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                  <div>
                    <Label>{t("setup.primaryColor")}</Label>
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
                    <Label>{t("setup.secondaryColor")}</Label>
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
                  <div className="mt-3">
                  <Label>{t("setup.logo")}</Label>
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
                        {t("common.chooseFile")}
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
                    {uploading && <span className="text-xs">{t("common.loading")}</span>}
                    {awayLogoPath && (
                      <Button variant="ghost" size="sm" onClick={() => setAwayLogoPath(null)}>
                        {t("common.remove")}
                      </Button>
                    )}
                  </div>
                </div>
                </details>
              </div>
            )}

            <div
              hidden={step !== 2}
              className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center"
            >
              <div className="text-[11px] font-bold uppercase tracking-widest text-primary">
                {sportProfile.label}
              </div>
              <div className="mt-1 text-lg font-black">
                {homeTeam.name} <span className="mx-2 text-muted-foreground">vs</span>{" "}
                {awayTeamLabel || t("setup.awayTeam")}
              </div>
            </div>

            <details hidden={step !== 2} className="group rounded-lg border border-border p-3">
              <summary className="cursor-pointer list-none text-sm font-semibold text-foreground">
                <span className="inline-flex w-full items-center justify-between gap-2">
                  {t("setup.optionalPlanningTitle")}
                  <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                    {t("setup.optionalPlanningClosed")}
                  </span>
                </span>
              </summary>
              <div className="mt-3 space-y-3 border-t border-border pt-3">
              <div>
                <Label>{t("setup.plannedKickoff")}</Label>
                <Input
                  type="datetime-local"
                  value={kickoffLocal}
                  onChange={(e) => setKickoffLocal(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("setup.matchSponsorLeadHelp", {
                    minutes: PREMATCH_MATCH_SPONSOR_LEAD_MS / 60_000,
                  })}
                </p>
              </div>
              <div>
                <Label>{t("setup.prematchWindowLabel")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={1}
                  placeholder={t("setup.prematchWindowPlaceholder")}
                  value={prematchWindowMin}
                  onChange={(e) => setPrematchWindowMin(e.target.value)}
                  className="mt-1 max-w-xs"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("setup.prematchWindowHelp")}
                </p>
              </div>
              <div>
                <Label>{t("setup.matchSponsorMedia")}</Label>
                <Select
                  value={matchSponsorMediaId}
                  onChange={(e) => setMatchSponsorMediaId(e.target.value)}
                  className="mt-1"
                >
                  <option value="">{t("setup.noSponsor")}</option>
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
            </details>

            {quickStart && (
              <div hidden={step !== 2} className="rounded-lg border border-border p-3 space-y-3">
                <div className="text-sm font-semibold">{t("setup.quickStartOptions")}</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActivateAfterCreate(true);
                      setStartSponsorRotation(false);
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      activateAfterCreate && !startSponsorRotation
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted/40"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{t("setup.startBoardOnly")}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t("setup.startBoardOnlyHelp")}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!sponsorMediaAvailable}
                    onClick={() => {
                      setActivateAfterCreate(true);
                      setStartSponsorRotation(true);
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      activateAfterCreate && startSponsorRotation
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted/40"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{t("setup.startWithSponsors")}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {sponsorMediaAvailable
                        ? t("setup.startWithSponsorsHelp")
                        : t("setup.startWithSponsorsUnavailable")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActivateAfterCreate(false);
                      setStartSponsorRotation(false);
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      !activateAfterCreate
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted/40"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{t("setup.saveForLater")}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t("setup.saveForLaterHelp")}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {step === 2 && (
            <Button variant="ghost" onClick={() => setStep(1)}>
              {t("setup.previousStep")}
            </Button>
          )}
          {step === 1 ? (
            <Button onClick={continueToOptions} disabled={!homeTeam}>
              {t("setup.nextStep")}
            </Button>
          ) : (
            <Button onClick={save} disabled={!homeTeam}>
              {quickStart
                ? activateAfterCreate
                  ? t("setup.createAndStart")
                  : t("setup.createForLater")
                : t("common.create")}
            </Button>
          )}
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
  const { t } = useTranslation();
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
          title: t("setup.scheduleInvalidPrematch"),
          description: t("setup.scheduleInvalidPrematchDesc"),
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
        toast({ title: t("setup.saveFailed"), description: await res.text(), variant: "error" });
        return;
      }
      toast({ title: t("setup.saved"), variant: "success" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("setup.scheduleTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {match.homeTeam.name}{" "}
          <span className="text-muted-foreground/80">{t("common.vs")}</span> {match.awayTeam.name}
        </p>
        <div className="grid gap-3 pt-2">
          <div>
            <Label>{t("setup.plannedKickoff")}</Label>
            <Input
              type="datetime-local"
              value={kickoffLocal}
              onChange={(e) => setKickoffLocal(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("setup.scheduleKickoffEmptyHelp", {
                minutes: PREMATCH_MATCH_SPONSOR_LEAD_MS / 60_000,
              })}
            </p>
          </div>
          <div>
            <Label>{t("setup.prematchWindowLabel")}</Label>
            <Input
              type="number"
              min={0}
              max={1440}
              step={1}
              placeholder={t("setup.prematchWindowPlaceholder")}
              value={prematchWindowMin}
              onChange={(e) => setPrematchWindowMin(e.target.value)}
              className="mt-1 max-w-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("setup.prematchWindowHelp")}
            </p>
          </div>
          <div>
            <Label>{t("setup.matchSponsorMedia")}</Label>
            <Select value={sponsorId} onChange={(e) => setSponsorId(e.target.value)} className="mt-1">
              <option value="">{t("setup.noSponsor")}</option>
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
            {t("common.close")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
