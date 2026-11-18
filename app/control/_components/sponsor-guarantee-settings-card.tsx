"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  parseSponsorGuaranteeSettings,
  serializeSponsorGuaranteeSettings,
  type SponsorGuaranteeSettings,
} from "@/lib/sponsor-guarantee-settings";

/**
 * Hoe sponsortijd geteld wordt: tellen handmatig gestarte sponsorclips mee, en hoeveel reserve
 * per fase de live-weergave achterhoudt voor goals, kaarten en wissels.
 */
export function SponsorGuaranteeSettingsCard({
  sponsorGuaranteeJson,
  onSaved,
}: {
  sponsorGuaranteeJson: string | null | undefined;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<SponsorGuaranteeSettings>(() =>
    parseSponsorGuaranteeSettings(sponsorGuaranteeJson),
  );
  const [reserveText, setReserveText] = useState(String(value.reserveSec));

  useEffect(() => {
    const next = parseSponsorGuaranteeSettings(sponsorGuaranteeJson);
    setValue(next);
    setReserveText(String(next.reserveSec));
  }, [sponsorGuaranteeJson]);

  async function save(next: SponsorGuaranteeSettings) {
    setValue(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sponsorGuaranteeJson: serializeSponsorGuaranteeSettings(next) }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved?.();
    } catch (err) {
      toast({
        title: t("reports.settingsSaveFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl p-6">
      <h3 className="text-base font-semibold mb-3">{t("reports.guaranteeSettingsTitle")}</h3>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={value.countManualPlays}
          onChange={(e) => void save({ ...value, countManualPlays: e.target.checked })}
        />
        <span>
          {t("reports.countManualPlays")}
          <span className="block text-xs text-muted-foreground">{t("reports.countManualPlaysHint")}</span>
        </span>
      </label>
      <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span>{t("reports.reserveSec")}</span>
        <Input
          type="number"
          min={0}
          max={900}
          className="w-24"
          value={reserveText}
          onChange={(e) => setReserveText(e.target.value)}
          onBlur={() => {
            const n = Number(reserveText);
            if (!Number.isFinite(n) || n === value.reserveSec) {
              setReserveText(String(value.reserveSec));
              return;
            }
            void save({ ...value, reserveSec: n });
          }}
        />
        <span className="basis-full text-xs text-muted-foreground">{t("reports.reserveSecHint")}</span>
      </label>
    </section>
  );
}
