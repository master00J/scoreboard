"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Megaphone, Square, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  ANNOUNCEMENT_DURATIONS_SEC,
  ANNOUNCEMENT_PRESET_LIMIT,
  ANNOUNCEMENT_TEXT_MAX,
  announcementVisible,
  cleanAnnouncementText,
  formatCountdown,
  type Announcement,
} from "@/lib/display-extras";
import { useDisplayExtras } from "@/lib/use-display-extras";
import { useWallClockMs } from "@/lib/use-wall-clock-tick";

/** Mededeling of lichtkrant op het stadionscherm, bediend vanuit het Live-tabblad. */
export function DisplayAnnouncementControl() {
  const { t } = useTranslation();
  const { extras, loaded, update } = useDisplayExtras();
  const announcement = extras.announcement;
  const now = useWallClockMs(1000);
  const onScreen = announcementVisible(announcement, now);
  const [text, setText] = useState("");
  const [durationSec, setDurationSec] = useState<number>(0);
  const seeded = useRef(false);

  // Eén keer de laatst gebruikte tekst klaarzetten; daarna is het veld van de operator.
  useEffect(() => {
    if (!loaded || seeded.current) return;
    seeded.current = true;
    setText(announcement.text);
  }, [loaded, announcement.text]);

  async function save(change: (current: Announcement) => Announcement) {
    const ok = await update((current) => ({ ...current, announcement: change(current.announcement) }));
    if (!ok) toast({ title: t("displayExtras.saveFailed"), variant: "error" });
  }

  const cleaned = cleanAnnouncementText(text);

  function show() {
    if (!cleaned) return;
    void save((current) => ({
      ...current,
      active: true,
      text: cleaned,
      until: durationSec > 0 ? Date.now() + durationSec * 1000 : null,
    }));
  }

  function stop() {
    void save((current) => ({ ...current, active: false, until: null }));
  }

  function savePreset() {
    if (!cleaned) return;
    void save((current) => ({
      ...current,
      presets: [cleaned, ...current.presets.filter((item) => item !== cleaned)].slice(0, ANNOUNCEMENT_PRESET_LIMIT),
    }));
  }

  return (
    <section className="order-3 flex flex-col gap-2 border-t border-border pt-2.5" data-announcement-control>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/90">
          <Megaphone className="size-3.5" />
          {t("displayExtras.announcementTitle")}
        </div>
        {onScreen ? (
          <span
            className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary"
            data-announcement-live
          >
            {t("displayExtras.announcementOnScreen")}
            {announcement.until
              ? ` · ${formatCountdown(Math.max(0, Math.ceil((announcement.until - now) / 1000)))}`
              : ""}
          </span>
        ) : null}
      </div>

      {onScreen ? (
        <p className="truncate text-[11px] text-muted-foreground" title={announcement.text}>
          “{announcement.text}”
        </p>
      ) : null}

      <div className="flex gap-1.5">
        <Input
          className="h-9 min-w-0 flex-1 text-sm"
          value={text}
          maxLength={ANNOUNCEMENT_TEXT_MAX}
          placeholder={t("displayExtras.announcementPlaceholder")}
          aria-label={t("displayExtras.announcementTitle")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") show();
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 px-2"
          disabled={!cleaned || announcement.presets.includes(cleaned)}
          title={t("displayExtras.presetSave")}
          aria-label={t("displayExtras.presetSave")}
          onClick={savePreset}
        >
          <Star className="size-4" />
        </Button>
      </div>

      {announcement.presets.length > 0 ? (
        <div className="flex flex-wrap gap-1" data-announcement-presets>
          {announcement.presets.map((preset) => (
            <span
              key={preset}
              className="flex max-w-full items-center gap-0.5 rounded-full border border-border bg-secondary/50 pl-2.5 text-[11px]"
            >
              <button type="button" className="max-w-[14rem] truncate py-1 text-left" onClick={() => setText(preset)}>
                {preset}
              </button>
              <button
                type="button"
                className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                title={t("displayExtras.presetRemove")}
                aria-label={t("displayExtras.presetRemove")}
                onClick={() =>
                  void save((current) => ({
                    ...current,
                    presets: current.presets.filter((item) => item !== preset),
                  }))
                }
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-1.5">
        <Select
          className="h-8 text-xs"
          value={String(durationSec)}
          aria-label={t("displayExtras.durationLabel")}
          onChange={(e) => setDurationSec(Number(e.target.value))}
        >
          {ANNOUNCEMENT_DURATIONS_SEC.map((seconds) => (
            <option key={seconds} value={seconds}>
              {t(`displayExtras.duration_${seconds}`)}
            </option>
          ))}
        </Select>
        <Select
          className="h-8 text-xs"
          value={announcement.position}
          aria-label={t("displayExtras.positionLabel")}
          onChange={(e) =>
            void save((current) => ({ ...current, position: e.target.value === "top" ? "top" : "bottom" }))
          }
        >
          <option value="bottom">{t("displayExtras.position_bottom")}</option>
          <option value="top">{t("displayExtras.position_top")}</option>
        </Select>
        <Select
          className="h-8 text-xs"
          value={announcement.tone}
          aria-label={t("displayExtras.toneLabel")}
          onChange={(e) =>
            void save((current) => ({ ...current, tone: e.target.value === "alert" ? "alert" : "neutral" }))
          }
        >
          <option value="neutral">{t("displayExtras.tone_neutral")}</option>
          <option value="alert">{t("displayExtras.tone_alert")}</option>
        </Select>
      </div>

      <div className="flex gap-1.5">
        <Button type="button" size="sm" className="h-9 flex-1" disabled={!cleaned} onClick={show}>
          {onScreen && cleaned !== announcement.text
            ? t("displayExtras.announcementUpdate")
            : t("displayExtras.announcementShow")}
        </Button>
        {onScreen ? (
          <Button type="button" size="sm" variant="destructive" className="h-9 gap-1.5" onClick={stop}>
            <Square className="size-3.5 fill-current" />
            {t("displayExtras.announcementStop")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
