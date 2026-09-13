import {
  mergeLivestreamAudioDevices,
  type LivestreamAudioDevice,
} from "@/lib/livestream";

export { mergeLivestreamAudioDevices as mergeAudioDeviceLists };

/**
 * Windows-microfoons via Chromium — zelfde pad als de camera-lijst.
 * Zonder microfoontoestemming geeft Chromium vaak géén audioinput terug
 * (camera's staan wél in de lijst omdat die al video-permission hebben).
 */
export async function enumerateAudioCaptureOptions(): Promise<LivestreamAudioDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  try {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      tmp.getTracks().forEach((track) => track.stop());
    } catch {
      /* geen default-mic — enumerateDevices kan daarna alsnog gelabelde inputs geven */
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audios = devices.filter((d) => d.kind === "audioinput");
    const seen = new Set<string>();
    const out: LivestreamAudioDevice[] = [];
    for (const device of audios) {
      const name = device.label?.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name });
    }
    return out;
  } catch {
    return [];
  }
}
