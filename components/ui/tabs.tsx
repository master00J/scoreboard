"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  setValue: (v: string) => void;
};

const Ctx = React.createContext<TabsContextValue | null>(null);

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  className,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const current = value ?? internal;
  const setValue = (v: string) => {
    setInternal(v);
    onValueChange?.(v);
  };
  return (
    <Ctx.Provider value={{ value: current, setValue }}>
      <div className={cn("relative flex min-h-0 flex-col", className)}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground gap-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("TabsTrigger must be inside Tabs");
  const active = ctx.value === value;
  return (
    <button
      onClick={() => ctx.setValue(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "hover:bg-background/50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
  forceMount = false,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Houd content gemount wanneer de tab niet actief is. Inactieve content wordt
   * offscreen geplaatst i.p.v. `display:none`, zodat timers/video-preview blijven lopen.
   */
  forceMount?: boolean;
}) {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("TabsContent must be inside Tabs");
  const active = ctx.value === value;
  if (!active && !forceMount) return null;
  return (
    <div
      className={cn("mt-4 min-h-0", active ? "flex flex-1 flex-col" : null, className)}
      aria-hidden={!active}
      // forceMount: buiten beeld houden zonder document-overflow (geen left:-100000px)
      style={
        active
          ? undefined
          : {
              position: "fixed",
              inset: 0,
              width: "100vw",
              height: "100vh",
              opacity: 0,
              pointerEvents: "none",
              overflow: "hidden",
              zIndex: -1,
            }
      }
    >
      {children}
    </div>
  );
}
