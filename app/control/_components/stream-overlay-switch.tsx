"use client";

import type { LivestreamSettings, StreamOverlayBreak, StreamOverlayPlay } from "@/lib/livestream";

type T = (key: string, opts?: Record<string, string | number>) => string;

function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: readonly { id: V; label: string }[];
  onChange: (next: V) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-[6.5rem] text-[11px] text-muted-foreground">{label}</span>
      <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            className={`h-7 rounded px-2.5 text-[11px] ${
              value === option.id
                ? "bg-primary font-semibold text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Snel wisselen tussen de vaste lagen en de eigen indeling uit Scherm indelen, apart voor het spel
 * en de pauze. Werkt ook terwijl de stream live staat: de streampagina volgt de instelling meteen.
 */
export function StreamOverlaySwitch({
  settings,
  onChange,
  t,
}: {
  settings: Pick<LivestreamSettings, "overlayPlay" | "overlayBreak">;
  onChange: (partial: Partial<Pick<LivestreamSettings, "overlayPlay" | "overlayBreak">>) => void;
  t: T;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Segmented<StreamOverlayPlay>
        label={t("livestream.overlayPlayLabel")}
        value={settings.overlayPlay}
        options={[
          { id: "widget", label: t("livestream.overlayPlay_widget") },
          { id: "custom", label: t("livestream.overlayPlay_custom") },
        ]}
        onChange={(overlayPlay) => onChange({ overlayPlay })}
      />
      <Segmented<StreamOverlayBreak>
        label={t("livestream.overlayBreakLabel")}
        value={settings.overlayBreak}
        options={[
          { id: "sponsors", label: t("livestream.overlayBreak_sponsors") },
          { id: "custom", label: t("livestream.overlayBreak_custom") },
        ]}
        onChange={(overlayBreak) => onChange({ overlayBreak })}
      />
      {settings.overlayPlay === "custom" || settings.overlayBreak === "custom" ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{t("livestream.overlayCustomHint")}</p>
      ) : null}
    </div>
  );
}
