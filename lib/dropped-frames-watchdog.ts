/**
 * Dropped-frames watchdog for sponsor videos.
 *
 * `HTMLVideoElement.getVideoPlaybackQuality()` reports cumulative counters, and
 * `totalVideoFrames` already includes the dropped frames (W3C Media Playback Quality).
 * So the share of dropped frames is `dropped / total`, never `dropped / (total + dropped)`:
 * that tops out at 50% and a 90% threshold could never be reached.
 *
 * The ratio is measured over a window (difference between two readings), so a rough start
 * or a long healthy stretch does not hide what the video is doing now.
 */

export type FrameQualityReading = {
  totalVideoFrames: number;
  droppedVideoFrames: number;
};

export const DROPPED_FRAMES_MIN_WINDOW_FRAMES = 140;
export const DROPPED_FRAMES_FAULT_RATIO = 0.9;

export type DroppedFramesCheck = {
  /** True when the window shows (almost) only dropped frames: skip the clip. */
  fault: boolean;
  /** Reading to compare the next one against (start of the current window). */
  baseline: FrameQualityReading;
  /** Frames and dropped frames in the window that was judged (0 while still collecting). */
  windowFrames: number;
  windowDropped: number;
  /** dropped / total in the judged window, or null while still collecting. */
  ratio: number | null;
};

function validReading(r: FrameQualityReading | null | undefined): r is FrameQualityReading {
  return (
    r != null &&
    Number.isFinite(r.totalVideoFrames) &&
    Number.isFinite(r.droppedVideoFrames) &&
    r.totalVideoFrames >= 0 &&
    r.droppedVideoFrames >= 0
  );
}

/**
 * Compare the current reading with the start of the window.
 * - No baseline yet, or counters went backwards (new source / reload): start a new window.
 * - Fewer than `minFrames` frames since the baseline: keep collecting, same baseline.
 * - Enough frames: judge `dropped / total` of that window and start the next window here.
 */
export function evaluateDroppedFrames(
  baseline: FrameQualityReading | null,
  current: FrameQualityReading,
  opts: { minFrames?: number; faultRatio?: number } = {},
): DroppedFramesCheck {
  const minFrames = opts.minFrames ?? DROPPED_FRAMES_MIN_WINDOW_FRAMES;
  const faultRatio = opts.faultRatio ?? DROPPED_FRAMES_FAULT_RATIO;
  const restart = (b: FrameQualityReading): DroppedFramesCheck => ({
    fault: false,
    baseline: b,
    windowFrames: 0,
    windowDropped: 0,
    ratio: null,
  });

  if (!validReading(current)) {
    return restart(validReading(baseline) ? baseline : { totalVideoFrames: 0, droppedVideoFrames: 0 });
  }
  if (!validReading(baseline)) return restart(current);
  if (
    current.totalVideoFrames < baseline.totalVideoFrames ||
    current.droppedVideoFrames < baseline.droppedVideoFrames
  ) {
    return restart(current);
  }

  const windowFrames = current.totalVideoFrames - baseline.totalVideoFrames;
  if (windowFrames < minFrames) {
    return { fault: false, baseline, windowFrames: 0, windowDropped: 0, ratio: null };
  }
  const windowDropped = Math.min(
    windowFrames,
    current.droppedVideoFrames - baseline.droppedVideoFrames,
  );
  const ratio = windowDropped / windowFrames;
  return {
    fault: ratio >= faultRatio,
    baseline: current,
    windowFrames,
    windowDropped,
    ratio,
  };
}
