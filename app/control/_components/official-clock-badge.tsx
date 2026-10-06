"use client";

import { useTranslation } from "react-i18next";
import { useOfficialClockStatus } from "@/lib/use-official-clock";

/**
 * Regel onder een klok in het bedieningspaneel: volgt hij de console, of loopt ArenaCue op eigen
 * kracht? Toont niets zolang het volgen uitstaat, zodat er voor andere clubs niets verandert.
 */
export function OfficialClockBadge({ clock }: { clock: "game" | "shot" }) {
  const { t } = useTranslation();
  const status = useOfficialClockStatus();
  if (!status || status.link === "off") return null;

  const following = clock === "game" ? status.followingGameClock : status.followingShotClock;
  if (following) {
    return (
      <div className="text-center text-[10px] font-semibold text-emerald-400" data-official-clock={clock}>
        ● {t("officialClock.badgeFollowing")}
      </div>
    );
  }
  // Signaal is er, maar deze klok volgen we bewust niet (uitgezet, of de periode is voorbij).
  if (status.link === "receiving") {
    if (clock !== "game" || !status.gameClockHold) return null;
    return (
      <div
        className="text-center text-[10px] font-semibold text-amber-300"
        title={t(`officialClock.hold_${status.gameClockHold}`)}
        data-official-clock={clock}
      >
        {t("officialClock.badgeHold")}
      </div>
    );
  }
  return (
    <div className="text-center text-[10px] font-semibold text-amber-300" data-official-clock={clock}>
      {t("officialClock.badgeLost")}
    </div>
  );
}
