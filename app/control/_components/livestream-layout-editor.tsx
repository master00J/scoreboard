"use client";

import { Label, Select } from "@/components/ui/form";
import type {
  LivestreamSponsorPosition,
  LivestreamSponsorScope,
  LivestreamSponsorStyle,
  StreamLayerLayout,
} from "@/lib/livestream";

export function LivestreamLayoutEditor({
  layout,
  onChange,
  t,
  idPrefix,
}: {
  layout: StreamLayerLayout;
  onChange: (partial: Partial<StreamLayerLayout>) => void;
  t: (key: string) => string;
  idPrefix: string;
}) {
  const stripMode = layout.sponsorStyle !== "break";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-secondary/20 p-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={layout.score} onChange={(e) => onChange({ score: e.target.checked })} />
        {t("livestream.overlay")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={layout.sponsors} onChange={(e) => onChange({ sponsors: e.target.checked })} />
        {t("livestream.sponsors")}
      </label>
      {layout.sponsors && (
        <>
          <Label htmlFor={`${idPrefix}-sponsor-style`}>{t("livestream.sponsorStyle")}</Label>
          <Select
            id={`${idPrefix}-sponsor-style`}
            value={layout.sponsorStyle}
            onChange={(e) => onChange({ sponsorStyle: e.target.value as LivestreamSponsorStyle })}
          >
            <option value="break">{t("livestream.sponsorBreak")}</option>
            <option value="logos">{t("livestream.sponsorLogos")}</option>
            <option value="lowerthird">{t("livestream.sponsorLowerthird")}</option>
          </Select>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("livestream.moreLayoutOptions")}</summary>
            <div className="mt-2 flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-sponsor-scope`}>{t("livestream.sponsorScope")}</Label>
              <Select
                id={`${idPrefix}-sponsor-scope`}
                value={layout.sponsorScope}
                onChange={(e) => onChange({ sponsorScope: e.target.value as LivestreamSponsorScope })}
              >
                <option value="phase">{t("livestream.sponsorScopePhase")}</option>
                <option value="all">{t("livestream.sponsorScopeAll")}</option>
              </Select>
              {stripMode ? (
                <>
                  <Label htmlFor={`${idPrefix}-sponsor-pos`}>{t("livestream.sponsorPosition")}</Label>
                  <Select
                    id={`${idPrefix}-sponsor-pos`}
                    value={layout.sponsorPosition}
                    onChange={(e) => onChange({ sponsorPosition: e.target.value as LivestreamSponsorPosition })}
                  >
                    <option value="auto">{t("livestream.sponsorPositionAuto")}</option>
                    <option value="top">{t("livestream.sponsorPositionTop")}</option>
                    <option value="bottom">{t("livestream.sponsorPositionBottom")}</option>
                  </Select>
                </>
              ) : null}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
