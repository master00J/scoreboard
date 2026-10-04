"use client";

import { useCallback, useEffect, useMemo } from "react";
import { displayExtrasFromJson, serializeDisplayExtras, type DisplayExtras } from "./display-extras";
import { useDisplayStore } from "./store";
import type { AppSettings } from "./types";
import { useApi } from "./use-api";

/**
 * Aftelklok en mededeling delen één instelling. `update` leest eerst de laatste stand, zodat het
 * Live-tabblad en Voorbereiden elkaars wijziging niet overschrijven.
 */
export function useDisplayExtras() {
  const { data: settings, reload, setData } = useApi<AppSettings>("/api/settings");
  const extras = useMemo(() => displayExtrasFromJson(settings?.displayExtrasJson), [settings?.displayExtrasJson]);

  // Elke wijziging aan de instellingen raakt de schermstatus aan: zo blijven Live, Voorbereiden en
  // een tweede bediening (mobiel) dezelfde stand tonen.
  const stateUpdatedAt = useDisplayStore((store) => store.state?.updatedAt);
  useEffect(() => {
    if (stateUpdatedAt) reload();
  }, [stateUpdatedAt, reload]);

  const update = useCallback(
    async (change: (current: DisplayExtras) => DisplayExtras): Promise<boolean> => {
      // Meteen tonen wat de operator koos; de server bevestigt daarna.
      setData((shown) =>
        shown
          ? {
              ...shown,
              displayExtrasJson: serializeDisplayExtras(change(displayExtrasFromJson(shown.displayExtrasJson))),
            }
          : shown,
      );
      try {
        const current = await fetch("/api/settings");
        if (!current.ok) throw new Error("settings");
        const latest = displayExtrasFromJson(((await current.json()) as AppSettings).displayExtrasJson);
        const res = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayExtrasJson: serializeDisplayExtras(change(latest)) }),
        });
        if (!res.ok) throw new Error("settings");
        reload();
        return true;
      } catch {
        // Terug naar wat echt opgeslagen is.
        reload();
        return false;
      }
    },
    [reload, setData],
  );

  return { extras, loaded: settings != null, update };
}
