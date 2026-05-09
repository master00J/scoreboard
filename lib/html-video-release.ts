/**
 * Chromium: bij unmount alleen het DOM-node verwijderen geeft MediaSource/decoder-slots
 * niet altijd direct vrij (Windows/Intel/AMD). pause + src wissen + load() is de gangbare fix.
 */
export function releaseHtmlVideoElement(video: HTMLVideoElement | null): void {
  if (!video) return;
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    /* ignore */
  }
}
