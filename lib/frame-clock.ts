/**
 * Vast beeldritme voor de livestream, zoals OBS: een klok bepaalt hoeveel beeldjes er naar ffmpeg
 * moeten, niet het toevallige moment waarop de app een beeld schildert.
 *
 * Het ritme blijft gelijk met de klok, zodat ffmpeg (dat elk beeldje bij aankomst stempelt) een
 * gelijkmatige stroom krijgt en niets hoeft weg te gooien of te verdubbelen. Komt er geen nieuw beeld,
 * dan gaat het vorige nog eens mee; achterstand wordt ingehaald in plaats van weggegooid.
 */
export class FrameClock {
  private startMs: number | null = null;
  private sent = 0;

  constructor(private readonly fps: number) {}

  /** De klok start bij het eerste beeldje dat echt verstuurd wordt. */
  start(nowMs: number): void {
    if (this.startMs == null) this.startMs = nowMs;
  }

  get started(): boolean {
    return this.startMs != null;
  }

  get framesSent(): number {
    return this.sent;
  }

  /** Hoeveel beeldjes er op dit moment verstuurd hadden moeten zijn (het lopende beeldje inbegrepen). */
  due(nowMs: number): number {
    if (this.startMs == null) return 0;
    return Math.floor(((nowMs - this.startMs) * this.fps) / 1000) + 1;
  }

  /** Hoeveel beeldjes de stream achterloopt op de klok. */
  behind(nowMs: number): number {
    return Math.max(0, this.due(nowMs) - this.sent);
  }

  /**
   * Mag er nu een beeldje weg? Een vers beeld gaat meteen, zolang de stream daarmee hooguit één
   * beeldje voorloopt: anders wacht het op een tik die op Windows te laat komt, wordt het door het
   * volgende beeld overschreven en moet er later een herhaald worden. Zonder vers beeld vult de klok
   * alleen gaten op met het vorige beeld.
   */
  shouldSend(nowMs: number, fresh: boolean): boolean {
    if (this.startMs == null) return fresh;
    return this.sent < this.due(nowMs) + (fresh ? 1 : 0);
  }

  markSent(): void {
    this.sent += 1;
  }
}
