"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label, Select } from "@/components/ui/form";
import {
  VOLLEYBALL_PRESET_IDS,
  VOLLEYBALL_PRESETS,
  formatTechnicalTimeoutScores,
  matchVolleyballPresetId,
  normalizeVolleyballMatchRules,
  parseTechnicalTimeoutScores,
  type VolleyballMatchRules,
  type VolleyballPresetId,
} from "@/lib/volleyball";

const PRESET_I18N: Record<Exclude<VolleyballPresetId, "custom">, string> = {
  indoor: "setup.presetIndoor",
  indoor_tto: "setup.presetIndoorTto",
  best_of_3: "setup.presetBestOf3",
  beach: "setup.presetBeach",
  youth_21: "setup.presetYouth21",
  italy_serie_a_men: "setup.presetItalySerieAMen",
};

export function VolleyballRulesFields({
  rules,
  onChange,
  servingStart,
  onServingStartChange,
}: {
  rules: VolleyballMatchRules;
  onChange: (next: VolleyballMatchRules) => void;
  servingStart: "home" | "away";
  onServingStartChange: (side: "home" | "away") => void;
}) {
  const { t } = useTranslation();
  const preset = matchVolleyballPresetId(rules);
  const [ttoText, setTtoText] = useState(formatTechnicalTimeoutScores(rules.technicalTimeoutScores));

  useEffect(() => {
    setTtoText(formatTechnicalTimeoutScores(rules.technicalTimeoutScores));
  }, [rules.technicalTimeoutScores]);

  function patch(partial: Partial<VolleyballMatchRules>) {
    onChange(normalizeVolleyballMatchRules({ ...rules, ...partial }));
  }

  function applyPreset(id: VolleyballPresetId) {
    if (id === "custom") return;
    onChange({ ...VOLLEYBALL_PRESETS[id] });
  }

  function commitTtoScores() {
    patch({ technicalTimeoutScores: parseTechnicalTimeoutScores(ttoText) });
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <Label htmlFor="vb-preset">{t("setup.volleyballPreset")}</Label>
        <Select
          id="vb-preset"
          className="mt-1"
          value={preset}
          onChange={(e) => applyPreset(e.target.value as VolleyballPresetId)}
        >
          {VOLLEYBALL_PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {t(PRESET_I18N[id])}
            </option>
          ))}
          <option value="custom">{t("setup.presetCustom")}</option>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">{t("setup.volleyballRulesHint")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="vb-format">{t("setup.setsToWin")}</Label>
          <Select
            id="vb-format"
            className="mt-1"
            value={String(rules.setsToWin)}
            onChange={(e) => patch({ setsToWin: Number(e.target.value) })}
          >
            <option value="3">{t("setup.bestOf5")}</option>
            <option value="2">{t("setup.bestOf3")}</option>
          </Select>
        </div>
        <div>
          <Label>{t("setup.servingStart")}</Label>
          <Select
            className="mt-1"
            value={servingStart}
            onChange={(e) => onServingStartChange(e.target.value as "home" | "away")}
          >
            <option value="home">{t("common.home")}</option>
            <option value="away">{t("common.away")}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="vb-points">{t("setup.pointsToWinSet")}</Label>
          <Input
            id="vb-points"
            type="number"
            min={5}
            max={99}
            className="mt-1"
            value={rules.pointsToWinSet}
            onChange={(e) => patch({ pointsToWinSet: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="vb-decider">{t("setup.pointsToWinDecider")}</Label>
          <Input
            id="vb-decider"
            type="number"
            min={5}
            max={99}
            className="mt-1"
            value={rules.pointsToWinDecider}
            onChange={(e) => patch({ pointsToWinDecider: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="vb-timeouts">{t("setup.timeoutsPerSet")}</Label>
          <Input
            id="vb-timeouts"
            type="number"
            min={0}
            max={6}
            className="mt-1"
            value={rules.timeoutsPerSet}
            onChange={(e) => patch({ timeoutsPerSet: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="vb-timeout-sec">{t("setup.timeoutDurationSec")}</Label>
          <Input
            id="vb-timeout-sec"
            type="number"
            min={5}
            max={180}
            className="mt-1"
            value={rules.timeoutDurationSec}
            onChange={(e) => patch({ timeoutDurationSec: Number(e.target.value) })}
          />
        </div>
        <div>
          <Label htmlFor="vb-break">{t("setup.setBreakSec")}</Label>
          <Input
            id="vb-break"
            type="number"
            min={30}
            max={600}
            step={30}
            className="mt-1"
            value={rules.setBreakSec}
            onChange={(e) => patch({ setBreakSec: Number(e.target.value) })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t("setup.setBreakSecHint", { min: Math.round(rules.setBreakSec / 60) })}
          </p>
        </div>
        <div>
          <Label htmlFor="vb-winby">{t("setup.winBy")}</Label>
          <Input
            id="vb-winby"
            type="number"
            min={1}
            max={5}
            className="mt-1"
            value={rules.winBy}
            onChange={(e) => patch({ winBy: Number(e.target.value) })}
          />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={rules.technicalTimeoutsEnabled}
          onChange={(e) => patch({ technicalTimeoutsEnabled: e.target.checked })}
        />
        <span>
          {t("setup.technicalTimeouts")}
          <span className="mt-0.5 block text-xs text-muted-foreground">{t("setup.technicalTimeoutsHint")}</span>
        </span>
      </label>

      {rules.technicalTimeoutsEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="vb-tto-scores">{t("setup.technicalTimeoutScores")}</Label>
            <Input
              id="vb-tto-scores"
              className="mt-1"
              value={ttoText}
              onChange={(e) => setTtoText(e.target.value)}
              onBlur={commitTtoScores}
              placeholder="8, 16"
            />
          </div>
          <div>
            <Label htmlFor="vb-tto-sec">{t("setup.technicalTimeoutDuration")}</Label>
            <Input
              id="vb-tto-sec"
              type="number"
              min={5}
              max={180}
              className="mt-1"
              value={rules.technicalTimeoutDurationSec}
              onChange={(e) => patch({ technicalTimeoutDurationSec: Number(e.target.value) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
