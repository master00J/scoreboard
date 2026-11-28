"use client";

import { useEffect, useState } from "react";

/**
 * Staat het stadionscherm echt op een monitor? Onwaar als de operator het venster verbergt of
 * het geminimaliseerd is. Dan telt er geen sponsortijd: niemand in het stadion ziet het beeld.
 *
 * Electron meldt dit expliciet (`display:windowVisibility`), want met `backgroundThrottling: false`
 * blijft `document.visibilityState` op "visible" staan. De paginastatus telt daarnaast ook mee.
 */
export function useDisplayWindowVisible(enabled = true): boolean {
  const [windowVisible, setWindowVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const off = window.electronAPI?.onDisplayWindowVisibility?.((payload) => {
      setWindowVisible(payload?.visible !== false);
    });
    const onPage = () => setPageVisible(document.visibilityState !== "hidden");
    onPage();
    document.addEventListener("visibilitychange", onPage);
    return () => {
      off?.();
      document.removeEventListener("visibilitychange", onPage);
    };
  }, [enabled]);

  return !enabled || (windowVisible && pageVisible);
}
