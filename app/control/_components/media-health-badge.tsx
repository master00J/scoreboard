"use client";

import { useTranslation } from "react-i18next";
import type { MediaItem } from "@/lib/types";
import { parseMediaCheckRecord } from "@/lib/media-health";

/**
 * Kaartje in de mediabibliotheek: toont een bestand dat de volledige controle kapot vond, of
 * waarvan de videokop niet leesbaar is. Vervangen gebeurt in de media-check.
 */
export function MediaHealthBadge({ item }: { item: Pick<MediaItem, "mediaCheckJson" | "playbackWarning" | "type"> }) {
  const { t } = useTranslation();
  const record = parseMediaCheckRecord(item.mediaCheckJson);
  if (record?.status === "broken") {
    return (
      <div className="text-[10px] font-semibold text-red-700 dark:text-red-400 leading-snug">
        {t("media.healthBrokenBadge")}
      </div>
    );
  }
  if (item.type === "VIDEO" && item.playbackWarning === "probe_failed") {
    return (
      <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 leading-snug">
        {t("media.probeFailedBadge")}
      </div>
    );
  }
  return null;
}
