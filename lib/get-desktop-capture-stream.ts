/**
 * Electron/Chromium: stream van een desktopCapturer-bron (venster of volledig scherm).
 * SDI-software op deze PC verschijnt meestal als een apart venster — kies die bron in de UI.
 */
export async function getDesktopCaptureStream(sourceId: string): Promise<MediaStream> {
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: 30,
      },
    },
  } as unknown as MediaStreamConstraints;
  return navigator.mediaDevices.getUserMedia(constraints);
}

const CAMERA_PREFIX = "camera:";

/** Bron-id uit UI: desktopCapturer-id óf `camera:${deviceId}` voor webcam / capturekaart. */
export function isCameraCaptureSourceId(sourceId: string): boolean {
  return sourceId.startsWith(CAMERA_PREFIX);
}

export function isWindowCaptureSourceId(sourceId: string): boolean {
  return sourceId.startsWith("window:");
}

export function isScreenCaptureSourceId(sourceId: string): boolean {
  return sourceId.startsWith("screen:");
}

export function isDesktopCaptureSourceId(sourceId: string): boolean {
  return isWindowCaptureSourceId(sourceId) || isScreenCaptureSourceId(sourceId);
}

export function isInternalArenaCueCaptureName(name: string): boolean {
  return /ArenaCue — (Browserbron|Mediabron|Inloggen)/i.test(name);
}

export type CameraCaptureOptions = {
  /** Forceer HD/Full HD waar mogelijk (ideaal voor pro HDMI/SDI capture-cards zoals Magewell, Elgato). */
  preferHighRes?: boolean;
  /** Schakel audio-passthrough in (bv. vMix/zendwagen feed met geluid). */
  audio?: boolean;
};

/**
 * Probeer eerst 1920x1080@30 voor pro capture-kaarten (Magewell, Elgato, Blackmagic)
 * en val terug op default constraints als de driver dat niet aankan.
 */
async function getCameraStreamWithFallback(
  deviceId: string,
  opts: CameraCaptureOptions,
): Promise<MediaStream> {
  const audioConstraint = opts.audio
    ? { deviceId: { exact: deviceId } }
    : false;

  if (opts.preferHighRes !== false) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 },
        },
      });
    } catch {
      /* fallthrough naar default */
    }
  }
  return navigator.mediaDevices.getUserMedia({
    audio: audioConstraint,
    video: { deviceId: { exact: deviceId } },
  });
}

export async function getCaptureStream(
  sourceId: string,
  opts: CameraCaptureOptions = {},
): Promise<MediaStream> {
  if (isCameraCaptureSourceId(sourceId)) {
    const deviceId = sourceId.slice(CAMERA_PREFIX.length);
    if (!deviceId.trim()) throw new Error("Ontbrekende camera-device-id");
    return getCameraStreamWithFallback(deviceId, opts);
  }
  return getDesktopCaptureStream(sourceId);
}
