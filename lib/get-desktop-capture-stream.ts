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

export async function getCaptureStream(sourceId: string): Promise<MediaStream> {
  if (isCameraCaptureSourceId(sourceId)) {
    const deviceId = sourceId.slice(CAMERA_PREFIX.length);
    if (!deviceId.trim()) throw new Error("Ontbrekende camera-device-id");
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: deviceId },
      },
    });
  }
  return getDesktopCaptureStream(sourceId);
}
