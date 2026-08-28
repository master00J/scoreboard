/**
 * Webcam / capturekaart / virtuele camera als bron voor hetzelfde pad als desktop capture.
 * Id-formaat: `camera:${deviceId}` (zie getCaptureStream).
 */
export type CameraCaptureOption = {
  id: string;
  name: string;
};

export async function enumerateCameraCaptureOptions(): Promise<CameraCaptureOption[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    let videos = devices.filter((d) => d.kind === "videoinput");
    if (videos.length === 0) return [];

    // Eerste keer zijn labels vaak leeg tot er een korte getUserMedia-gum was.
    if (videos.some((d) => !d.label)) {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      tmp.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
      videos = devices.filter((d) => d.kind === "videoinput");
    }

    return videos.map((d, i) => ({
      id: `camera:${d.deviceId}`,
      name: d.label?.trim() || `Camera ${i + 1}`,
    }));
  } catch {
    return [];
  }
}
