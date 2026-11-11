/**
 * Houdt een stroom ruwe PCM op het tempo van de klok, geteld in frames.
 *
 * ffmpeg leest elk geluidskanaal van de livestream uit een pipe zonder tijdstempels: de tijd ís het
 * aantal frames. Komt er te weinig binnen, dan wacht de mix op dat ene kanaal en loopt de hele
 * stream achter; komt er te veel binnen, dan schuift dat geluid naar achteren ten opzichte van het
 * beeld. Een kanaal moet dus precies `sampleRate` frames per seconde leveren, ook als de bron
 * zwijgt of even hapert.
 *
 * - `fill` zegt hoeveel frames stilte er nu bij moeten om op tempo te blijven.
 * - `admit` zegt hoeveel frames echt geluid er nog bij mogen; wat verder dan `maxLeadMs` voor zou
 *   lopen, valt weg (anders stapelt elke hapering een blijvende vertraging op).
 *
 * Beide tellen wat ze teruggeven meteen als geschreven. `nowMs` hoort een monotone klok te zijn.
 */
export type PcmPacer = {
  fill: (nowMs: number, slackMs?: number) => number;
  admit: (nowMs: number, frames: number) => number;
  /** Frames die tot nu toe geteld zijn (stilte en geluid samen). */
  written: () => number;
};

export function createPcmPacer(options: {
  sampleRate: number;
  startMs: number;
  /** Zoveel mag echt geluid voorlopen op de klok. */
  maxLeadMs?: number;
  /** Grootste stuk stilte per aanroep; de rest volgt bij de volgende. */
  maxFillMs?: number;
}): PcmPacer {
  const rate = Math.max(1, Math.floor(options.sampleRate));
  const framesOf = (ms: number) => Math.max(0, Math.floor((ms * rate) / 1000));
  const leadFrames = framesOf(options.maxLeadMs ?? 250);
  const maxFillFrames = Math.max(1, framesOf(options.maxFillMs ?? 2000));
  let written = 0;

  const due = (nowMs: number) => framesOf(nowMs - options.startMs);

  return {
    fill: (nowMs, slackMs = 0) => {
      const deficit = due(nowMs) - written;
      if (deficit <= framesOf(slackMs)) return 0;
      const frames = Math.min(deficit, maxFillFrames);
      written += frames;
      return frames;
    },
    admit: (nowMs, frames) => {
      const wanted = Math.max(0, Math.floor(frames));
      const room = due(nowMs) + leadFrames - written;
      const accepted = Math.max(0, Math.min(wanted, room));
      written += accepted;
      return accepted;
    },
    written: () => written,
  };
}
