"use client";

import { useEffect, useState } from "react";
import {
  getDesktopCaptureStream,
  getTabCaptureStream,
} from "@/lib/get-desktop-capture-stream";
import { useDisplayPreviewFrame } from "@/lib/use-display-preview-frame";

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

async function openDisplayPreviewStream(): Promise<MediaStream> {
  const api = window.electronAPI;
  const ids = await api?.getDisplayPreviewCaptureIds?.();
  if (!ids) throw new Error("preview ids unavailable");
  if (ids.tabId) {
    try {
      return await getTabCaptureStream(ids.tabId);
    } catch {
      try {
        return await getDesktopCaptureStream(ids.tabId);
      } catch {
        /* venster-id hieronder */
      }
    }
  }
  if (ids.windowId) return await getDesktopCaptureStream(ids.windowId);
  throw new Error("preview capture unavailable");
}

/**
 * Live 1080p@30 van het LED-venster. Geen tweede mp4-decoder: het is een kopie van
 * het al gecomponeerde scherm. JPEG blijft achtervang als de stream niet start.
 */
export function useDisplayPreviewPlayback(active: boolean): {
  stream: MediaStream | null;
  jpeg: string | null;
} {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const jpeg = useDisplayPreviewFrame(active && !stream);

  useEffect(() => {
    if (!active) {
      setStream(null);
      return;
    }
    if (typeof window === "undefined" || !window.electronAPI?.getDisplayPreviewCaptureIds) {
      return;
    }

    let cancelled = false;
    let current: MediaStream | null = null;

    const run = async () => {
      while (!cancelled) {
        try {
          const next = await openDisplayPreviewStream();
          if (cancelled) {
            stopStream(next);
            return;
          }
          current = next;
          setStream(next);
          const tracks = next.getTracks();
          if (tracks.length === 0) throw new Error("empty preview stream");
          await Promise.race(
            tracks.map(
              (track) =>
                new Promise<void>((resolve) => {
                  track.addEventListener("ended", () => resolve(), { once: true });
                }),
            ),
          );
          if (cancelled) return;
          stopStream(current);
          current = null;
          setStream(null);
          await new Promise((r) => window.setTimeout(r, 400));
        } catch {
          if (cancelled) return;
          await new Promise((r) => window.setTimeout(r, 1000));
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      stopStream(current);
    };
  }, [active]);

  return { stream, jpeg };
}
