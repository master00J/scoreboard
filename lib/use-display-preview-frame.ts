"use client";

import { useEffect, useState } from "react";

/**
 * JPEG-frames van het LED-venster. Geen tweede HTML-videodecoder in control —
 * die liet 1080p-clips de UI vastlopen.
 */
export function useDisplayPreviewFrame(active: boolean): string | null {
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      window.electronAPI?.setDisplayPreviewCapture?.(false);
      return;
    }
    const api = window.electronAPI;
    if (!api?.setDisplayPreviewCapture) return;
    api.setDisplayPreviewCapture(true);
    const off = api.onDisplayPreviewFrame?.((jpeg) => setFrame(jpeg));
    return () => {
      off?.();
      api.setDisplayPreviewCapture?.(false);
    };
  }, [active]);

  return frame;
}
