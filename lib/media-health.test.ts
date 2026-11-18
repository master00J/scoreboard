import { describe, expect, it } from "vitest";
import {
  classifyDecodeRun,
  decodeErrorLines,
  decodeTimeoutMs,
  isAnimatedWebp,
  isValidTranscodeOutput,
  mediaFileVersionKey,
  mediaHealthFor,
  parseDecodeProgress,
  parseMediaCheckRecord,
  type DecodeRun,
  type MediaCheckRecord,
} from "./media-health";

/** Uitvoer van de meegeleverde FFmpeg 7.1 op echte testbestanden (10 s 720p H.264). */
const PROGRESS_FULL = "frame=150\nout_time_us=5000000\nprogress=continue\nframe=300\nout_time_us=10000000\nprogress=end\n";
const PROGRESS_HALF = "frame=149\nout_time_us=4966667\nprogress=end\n";
const PROGRESS_NONE = "frame=0\nout_time_us=N/A\nprogress=end\n";
const STDERR_TRUNCATED = [
  "[h264 @ 000001f1822ce400] Invalid NAL unit size (14664 > 8141).",
  "[h264 @ 000001f1822ce400] missing picture in access unit with size 8145",
  "[mov,mp4,m4a,3gp,3g2,mj2 @ 000001f181e1ed00] stream 0, offset 0x1e9761: partial file",
].join("\n");
const STDERR_NO_MOOV = [
  "[mov,mp4,m4a,3gp,3g2,mj2 @ 000001f7ff20ec80] moov atom not found",
  "[in#0 @ 000001f7ff20e880] Error opening input: Invalid data found when processing input",
  "Error opening input file C:\\Clips\\sponsor.mp4.",
  "Error opening input files: Invalid data found when processing input",
].join("\n");
const STDERR_BROKEN_PNG = [
  "[png @ 0000015be5c383c0] chunk too big",
  "[vist#0:0/png @ 0000015be5c383c0] [dec:png @ 0000015be5c21280] Decoding error: Invalid data found when processing input",
  "[vist#0:0/png @ 0000015be5c383c0] [dec:png @ 0000015be5c21280] Task finished with error code: -1094995529 (Invalid data found when processing input)",
].join("\n");

function run(partial: Partial<DecodeRun>): DecodeRun {
  return { exitCode: 0, timedOut: false, progress: PROGRESS_FULL, stderr: "", ...partial };
}

describe("parseDecodeProgress", () => {
  it("leest het laatste beeld en de gedecodeerde tijd", () => {
    expect(parseDecodeProgress(PROGRESS_FULL)).toEqual({ frames: 300, decodedSec: 10 });
    expect(parseDecodeProgress(PROGRESS_HALF).decodedSec).toBeCloseTo(4.97, 2);
  });

  it("geeft geen tijd als FFmpeg niets decodeerde", () => {
    expect(parseDecodeProgress(PROGRESS_NONE)).toEqual({ frames: 0, decodedSec: null });
    expect(parseDecodeProgress("")).toEqual({ frames: 0, decodedSec: null });
  });
});

describe("classifyDecodeRun", () => {
  it("keurt een volledige video goed", () => {
    const r = classifyDecodeRun({ kind: "VIDEO", expectedSec: 10, run: run({}) });
    expect(r).toMatchObject({ status: "ok", reason: "ok", decodedSec: 10, detail: null });
  });

  it("meldt een MP4 waarvan de tweede helft ontbreekt als kapot", () => {
    // De kop zegt 10 s; FFmpeg stopt met fouten na 5 s, maar met exitcode 0.
    const r = classifyDecodeRun({
      kind: "VIDEO",
      expectedSec: 10,
      run: run({ progress: PROGRESS_HALF, stderr: STDERR_TRUNCATED }),
    });
    expect(r.status).toBe("broken");
    expect(r.reason).toBe("truncated");
    expect(r.decodedSec).toBeCloseTo(4.97, 2);
    expect(r.detail).toBe("Invalid NAL unit size (14664 > 8141).");
  });

  it("meldt ook een afgekapte video met foutcode als afgekapt", () => {
    const r = classifyDecodeRun({
      kind: "VIDEO",
      expectedSec: 10,
      run: run({ exitCode: 183, progress: PROGRESS_HALF, stderr: STDERR_TRUNCATED }),
    });
    expect(r).toMatchObject({ status: "broken", reason: "truncated" });
  });

  it("meldt een MP4 zonder leesbare kop als onleesbaar, zonder het pad te bewaren", () => {
    const r = classifyDecodeRun({
      kind: "VIDEO",
      expectedSec: null,
      run: run({ exitCode: 183, progress: "", stderr: STDERR_NO_MOOV }),
    });
    expect(r).toMatchObject({ status: "broken", reason: "unreadable", detail: "moov atom not found" });
    expect(JSON.stringify(r)).not.toContain("Clips");
  });

  it("meldt een kapotte PNG als onleesbaar", () => {
    const r = classifyDecodeRun({
      kind: "IMAGE",
      expectedSec: null,
      run: run({ exitCode: 183, progress: PROGRESS_NONE, stderr: STDERR_BROKEN_PNG }),
    });
    expect(r).toMatchObject({ status: "broken", reason: "unreadable", detail: "chunk too big", decodedSec: null });
  });

  it("keurt een goede afbeelding goed", () => {
    const r = classifyDecodeRun({
      kind: "IMAGE",
      expectedSec: null,
      run: run({ progress: "frame=1\nout_time_us=40000\nprogress=end\n" }),
    });
    expect(r).toMatchObject({ status: "ok", reason: "ok" });
  });

  it("ziet een klein verschil in duur niet als fout", () => {
    const r = classifyDecodeRun({
      kind: "VIDEO",
      expectedSec: 10.4,
      run: run({}),
    });
    expect(r.status).toBe("ok");
  });

  it("waarschuwt, zonder kapot te zeggen, als een foutloze video veel korter is dan de kop", () => {
    const r = classifyDecodeRun({ kind: "VIDEO", expectedSec: 30, run: run({}) });
    expect(r).toMatchObject({ status: "warning", reason: "duration_mismatch" });
  });

  it("waarschuwt bij decoderfouten in een volledige video", () => {
    const r = classifyDecodeRun({ kind: "VIDEO", expectedSec: 10, run: run({ stderr: STDERR_TRUNCATED }) });
    expect(r).toMatchObject({ status: "warning", reason: "decode_errors" });
  });

  it("noemt een afgebroken controle geen kapot bestand", () => {
    const r = classifyDecodeRun({
      kind: "VIDEO",
      expectedSec: 600,
      run: run({ timedOut: true, exitCode: null, progress: PROGRESS_HALF }),
    });
    expect(r).toMatchObject({ status: "warning", reason: "timeout" });
  });
});

describe("isValidTranscodeOutput", () => {
  it("laat alleen een foutloze, volledige kopie het origineel vervangen", () => {
    expect(isValidTranscodeOutput({ status: "ok" })).toBe(true);
    expect(isValidTranscodeOutput({ status: "warning" })).toBe(false);
    expect(isValidTranscodeOutput({ status: "broken" })).toBe(false);
  });

  it("weigert de kopie van een afgekapte bron", () => {
    // Omzetten van een afgekapte bron geeft een foutloze maar korte kopie.
    const r = classifyDecodeRun({ kind: "VIDEO", expectedSec: 10, run: run({ progress: PROGRESS_HALF }) });
    expect(isValidTranscodeOutput(r)).toBe(false);
  });
});

describe("mediaFileVersionKey", () => {
  it("is gelijk voor dezelfde bestandsversie", () => {
    expect(mediaFileVersionKey("C:\\Clips\\a.mp4", 1000, 1700000000123.7)).toBe(
      mediaFileVersionKey("C:\\Clips\\a.mp4", 1000, 1700000000123.2),
    );
  });

  it("verandert met pad, grootte of wijzigingstijd", () => {
    const base = mediaFileVersionKey("C:\\Clips\\a.mp4", 1000, 1700000000000);
    expect(mediaFileVersionKey("C:\\Clips\\b.mp4", 1000, 1700000000000)).not.toBe(base);
    expect(mediaFileVersionKey("C:\\Clips\\a.mp4", 1001, 1700000000000)).not.toBe(base);
    expect(mediaFileVersionKey("C:\\Clips\\a.mp4", 1000, 1700000005000)).not.toBe(base);
  });

  it("bevat geen pad dat de venue-back-up als bestand zou zien", () => {
    const key = mediaFileVersionKey("C:\\Clips\\a.mp4", 1000, 1700000000000);
    expect(key).not.toMatch(/[\\/:]/);
  });
});

describe("parseMediaCheckRecord", () => {
  it("leest een bewaarde controle terug", () => {
    const record: MediaCheckRecord = {
      v: 1,
      key: "1-2-abcd",
      status: "broken",
      reason: "truncated",
      expectedSec: 10,
      decodedSec: 5,
      detail: "partial file",
      checkedAt: "2026-11-17T10:00:00.000Z",
    };
    expect(parseMediaCheckRecord(JSON.stringify(record))).toEqual(record);
  });

  it("negeert lege, kapotte of onbekende waarden", () => {
    expect(parseMediaCheckRecord(null)).toBeNull();
    expect(parseMediaCheckRecord("{")).toBeNull();
    expect(parseMediaCheckRecord(JSON.stringify({ v: 2, key: "x", status: "ok", reason: "ok" }))).toBeNull();
    expect(parseMediaCheckRecord(JSON.stringify({ v: 1, key: "x", status: "pending", reason: "ok" }))).toBeNull();
  });
});

describe("mediaHealthFor", () => {
  const broken: MediaCheckRecord = {
    v: 1,
    key: "k1",
    status: "broken",
    reason: "truncated",
    expectedSec: 10,
    decodedSec: 5,
    detail: "partial file",
    checkedAt: "",
  };
  const ok: MediaCheckRecord = { ...broken, status: "ok", reason: "ok", decodedSec: 10, detail: null };

  it("meldt een ontbrekend bestand als kapot", () => {
    expect(mediaHealthFor({ fileExists: false, currentKey: null, record: ok })).toMatchObject({
      status: "broken",
      reason: "missing_file",
    });
  });

  it("gebruikt de bewaarde controle zolang het bestand niet veranderde", () => {
    expect(mediaHealthFor({ fileExists: true, currentKey: "k1", record: broken })).toMatchObject({
      status: "broken",
      reason: "truncated",
      decodedSec: 5,
      expectedSec: 10,
    });
    expect(mediaHealthFor({ fileExists: true, currentKey: "k1", record: ok }).status).toBe("ok");
  });

  it("vertrouwt een controle van een vorige bestandsversie niet", () => {
    expect(mediaHealthFor({ fileExists: true, currentKey: "k2", record: broken })).toMatchObject({
      status: "pending",
      reason: "not_checked",
    });
  });

  it("houdt probe_failed als waarschuwing", () => {
    expect(
      mediaHealthFor({ fileExists: true, currentKey: "k2", record: null, probeReason: "probe_failed" }),
    ).toMatchObject({ status: "warning", reason: "probe_failed" });
    expect(
      mediaHealthFor({ fileExists: true, currentKey: "k1", record: ok, probeReason: "probe_failed" }),
    ).toMatchObject({ status: "warning", reason: "probe_failed" });
  });

  it("laat een kapotte decode voorgaan op probe_failed", () => {
    expect(
      mediaHealthFor({ fileExists: true, currentKey: "k1", record: broken, probeReason: "probe_failed" }).status,
    ).toBe("broken");
  });

  it("zegt dat de controle wacht tot na de wedstrijd", () => {
    expect(mediaHealthFor({ fileExists: true, currentKey: "k1", record: null, deferred: true })).toMatchObject({
      status: "pending",
      reason: "deferred_live_match",
    });
  });

  it("meldt ontbrekende FFmpeg als waarschuwing", () => {
    expect(
      mediaHealthFor({ fileExists: true, currentKey: "k1", record: null, probeReason: "ffmpeg_missing" }),
    ).toMatchObject({ status: "warning", reason: "ffmpeg_missing" });
  });
});

describe("decodeErrorLines", () => {
  it("haalt adressen en streamlabels weg", () => {
    expect(decodeErrorLines(STDERR_BROKEN_PNG)[1]).toBe(
      "Decoding error: Invalid data found when processing input",
    );
  });
});

describe("decodeTimeoutMs", () => {
  it("geeft lange clips meer tijd, met een bovengrens", () => {
    expect(decodeTimeoutMs("IMAGE", null)).toBe(30_000);
    expect(decodeTimeoutMs("VIDEO", 30)).toBe(150_000);
    expect(decodeTimeoutMs("VIDEO", 100_000)).toBe(15 * 60_000);
  });
});

describe("isAnimatedWebp", () => {
  function webp(chunk: string, flags: number): Uint8Array {
    const bytes = new Uint8Array(32);
    const put = (at: number, text: string) => [...text].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
    put(0, "RIFF");
    put(8, "WEBP");
    put(12, chunk);
    bytes[20] = flags;
    return bytes;
  }

  it("herkent een bewegende WebP", () => {
    expect(isAnimatedWebp(webp("VP8X", 0x02))).toBe(true);
    expect(isAnimatedWebp(webp("VP8X", 0x10))).toBe(false);
    expect(isAnimatedWebp(webp("VP8 ", 0x02))).toBe(false);
    expect(isAnimatedWebp(new Uint8Array(4))).toBe(false);
  });
});
