"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Bouwstenen voor de livestream-studio.
 *
 * Uitgangspunt: wat je tijdens een wedstrijd bedient staat open, wat je één keer
 * instelt zit achter een samenvatting. Zo past de hele studio zonder scrollen op
 * één scherm en zie je toch in één oogopslag hoe alles staat.
 */

/** Sectie met titel, samenvatting rechts en optioneel inklapbare inhoud. */
export function StudioSection({
  title,
  summary,
  children,
  actions,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </span>
          {summary ? (
            <span className="truncate text-[11px] text-muted-foreground">{summary}</span>
          ) : null}
        </div>
        {actions}
      </div>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </section>
  );
}

/**
 * Inklapbaar blok met een samenvatting in de kop. Gebruikt `<details>` zodat de
 * open/dicht-stand ook zonder React-state werkt en toetsenbordbediening klopt.
 */
export function StudioDisclosure({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group rounded-lg border border-border bg-background/40" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[11px]">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-medium">{title}</span>
          {summary ? <span className="truncate text-muted-foreground">{summary}</span> : null}
        </span>
        <span className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-border px-2.5 py-2">{children}</div>
    </details>
  );
}

/** Compacte label-boven-veld cel voor rijen met meerdere instellingen naast elkaar. */
export function StudioField({
  label,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** Preview- of program-monitor, zoals in een TV-regie. */
export function StudioMonitor({
  label,
  name,
  tone,
  children,
}: {
  label: string;
  name: string;
  tone: "preview" | "program" | "live";
  children: ReactNode;
}) {
  const bar =
    tone === "live"
      ? "bg-red-600 text-white"
      : tone === "program"
        ? "bg-emerald-600 text-white"
        : "bg-amber-500 text-black";
  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md bg-black ring-1 ring-white/10">
      <div className={`flex shrink-0 items-center justify-between gap-2 px-2 py-0.5 text-[10px] font-semibold ${bar}`}>
        <span className="uppercase tracking-wide">{label}</span>
        <span className="truncate font-medium opacity-90">{name}</span>
      </div>
      <div className="relative min-h-0 w-full flex-1 bg-black">
        <MonitorCanvas>{children}</MonitorCanvas>
      </div>
    </div>
  );
}

/**
 * Precies 16:9 binnen het monitorvlak (dat door de balk erboven iets breder is). Het kader van een
 * scènelaag staat in procenten van het programmabeeld; alleen op een 16:9-vlak ziet de monitor er
 * dan uit zoals de stream, en valt het rode bewerkkader precies over het beeld.
 */
function MonitorCanvas({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const measure = () => {
      const width = outer.clientWidth;
      const height = outer.clientHeight;
      if (width <= 0 || height <= 0) return;
      let w = width;
      let h = (w * 9) / 16;
      if (h > height) {
        h = height;
        w = (h * 16) / 9;
      }
      setSize((prev) => (prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={outerRef} className="absolute inset-0 grid place-items-center overflow-hidden">
      <div
        className="relative overflow-hidden"
        style={size ? { width: size.w, height: size.h } : { width: "100%", height: "100%" }}
        data-monitor-canvas
      >
        {children}
      </div>
    </div>
  );
}

export function StudioMonitorEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-white/45">{children}</div>
  );
}

/** Statuslampje + tekst, voor de balk boven de preview. */
export function StudioStat({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "warn" | "bad";
}) {
  const color =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-400" : "text-foreground";
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`text-[11px] font-medium tabular-nums ${color}`}>{value}</span>
    </span>
  );
}
