"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { sendCommand } from "@/lib/use-socket";
import { useDisplayStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { isFullMatch } from "@/lib/is-full-match";
import { tMatchStatus } from "@/lib/i18n/t-phase";

/**
 * Shows a banner if on initial load we find a match in the middle of play
 * (status FIRST_HALF/SECOND_HALF/EXTRA_TIME) — offers Resume or Start fresh.
 * If Resume: keeps state as-is. If Start fresh: resets timer to 0 and sets status PREMATCH.
 */
export function CrashRecoveryBanner() {
  const { t } = useTranslation();
  const state = useDisplayStore((s) => s.state);
  const [match, setMatch] = useState<{
    id: string;
    homeTeam: { name: string };
    awayTeam: { name: string };
    status: string;
    homeScore: number;
    awayScore: number;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (checked) return;
    if (!state?.matchId) return;
    setChecked(true);
    fetch(`/api/matches/${state.matchId}`)
      .then(async (r) => {
        const m = await r.json().catch(() => null);
        if (!r.ok || !isFullMatch(m)) return;
        if (["FIRST_HALF", "SECOND_HALF", "EXTRA_TIME"].includes(m.status)) {
          setMatch(m);
        }
      })
      .catch(() => {});
  }, [state?.matchId, checked]);

  if (!match || dismissed) return null;

  return (
    <div className="bg-amber-500/15 border border-amber-500/40 rounded-xl p-4 flex items-center justify-between gap-4 mb-4">
      <div>
        <div className="font-semibold text-amber-400">{t("crash.title")}</div>
        <div className="text-xs text-muted-foreground">
          {t("crash.body")}{" "}
          {match.homeTeam.name} vs {match.awayTeam.name} · {match.homeScore}–{match.awayScore} ·{" "}
          {tMatchStatus(t, match.status)}
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDismissed(true)}
        >
          {t("crash.resume")}
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            await sendCommand({ type: "timer:set", seconds: 0 });
            await sendCommand({ type: "match:setStatus", status: "PREMATCH" });
            setDismissed(true);
          }}
        >
          {t("crash.startFresh")}
        </Button>
      </div>
    </div>
  );
}
