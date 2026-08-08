"use client";

import { useEffect, useRef, useState } from "react";
import { useDisplayStore } from "@/lib/store";
import { sendCommand } from "@/lib/use-socket";

/**
 * Real-time display health monitoring with video playback diagnostics and auto-recovery.
 * Tracks:
 * - Video stuck detection (no frame updates for 5+ seconds)
 * - Memory/resource issues
 * - Disconnection recovery
 * - Playback errors with suggestions
 */
export function DisplayHealthMonitor() {
  const connected = useDisplayStore((s) => s.connected);
  const state = useDisplayStore((s) => s.state);
  const [health, setHealth] = useState<{
    videoStuck: boolean;
    stuckDuration: number;
    lastFrameTime: number;
    errorCount: number;
    lastError: string | null;
    recoveryAttempts: number;
  }>({
    videoStuck: false,
    stuckDuration: 0,
    lastFrameTime: Date.now(),
    errorCount: 0,
    lastError: null,
    recoveryAttempts: 0,
  });

  const healthCheckRef = useRef<NodeJS.Timeout | null>(null);
  const errorCountRef = useRef(0);
  const recoveryAttemptsRef = useRef(0);

  // Monitor video element state
  useEffect(() => {
    // Listen for video diagnostics from the display window
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "video-diagnostic") {
        const { event: diagEvent, mediaErrorMessage } = event.data;

        // Track errors
        if (diagEvent === "error" || diagEvent?.includes("error")) {
          errorCountRef.current++;
          setHealth((prev) => ({
            ...prev,
            errorCount: errorCountRef.current,
            lastError: mediaErrorMessage,
          }));

          // Auto-recovery: attempt to reload after 2 errors in 10 seconds
          if (errorCountRef.current >= 2) {
            attemptRecovery();
          }
        }

        // Track stuck video detection
        if (diagEvent?.includes("watchdog_no_metadata")) {
          const now = Date.now();
          const stuckMs = now - health.lastFrameTime;
          if (stuckMs > 5000) {
            setHealth((prev) => ({
              ...prev,
              videoStuck: true,
              stuckDuration: stuckMs,
            }));
            attemptRecovery();
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [health.lastFrameTime]);

  // Periodic health check
  useEffect(() => {
    if (!connected) {
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
      return;
    }

    healthCheckRef.current = setInterval(() => {
      // Check for heartbeat timeout (no state updates for 30+ seconds)
      const now = Date.now();
      const lastUpdate = state?.updatedAt ? new Date(state.updatedAt).getTime() : now;
      const timeSinceUpdate = now - lastUpdate;

      if (timeSinceUpdate > 30_000 && state?.mode && !["IDLE"].includes(state.mode)) {
        console.warn("[health] No state update for 30+ seconds, attempting recovery");
        attemptRecovery();
      }

      // Reset error count every 10 seconds if no new errors
      if (errorCountRef.current > 0) {
        errorCountRef.current = Math.max(0, errorCountRef.current - 1);
      }
    }, 10_000);

    return () => {
      if (healthCheckRef.current) clearInterval(healthCheckRef.current);
    };
  }, [connected, state?.mode, state?.updatedAt]);

  const attemptRecovery = async () => {
    recoveryAttemptsRef.current++;
    console.warn(`[health] Recovery attempt #${recoveryAttemptsRef.current}`);

    setHealth((prev) => ({
      ...prev,
      recoveryAttempts: recoveryAttemptsRef.current,
      videoStuck: false,
    }));

    // Attempt 1: Switch to idle briefly then back
    if (recoveryAttemptsRef.current === 1) {
      try {
        const currentMode = state?.mode;
        if (currentMode && currentMode !== "IDLE") {
          await sendCommand({ type: "display:setMode", mode: "IDLE" });
          await new Promise((r) => setTimeout(r, 500));
          await sendCommand({ type: "display:setMode", mode: currentMode as any });
        }
      } catch (e) {
        console.error("[health] Mode switch failed:", e);
      }
    }

    // Attempt 2: Request safe mode
    if (recoveryAttemptsRef.current === 2) {
      try {
        await sendCommand({ type: "display:setSafeMode", enabled: true });
      } catch (e) {
        console.error("[health] Safe mode activation failed:", e);
      }
    }

    // Attempt 3: Full page reload (safe for IDLE/SPONSOR/SPONSOR_ROTATION)
    if (recoveryAttemptsRef.current >= 3) {
      const safeModes = new Set(["IDLE", "SPONSOR_ROTATION", "SPONSOR"]);
      if (safeModes.has(state?.mode ?? "IDLE")) {
        console.warn("[health] Performing emergency reload");
        window.location.reload();
      }
    }
  };

  return null;
}
