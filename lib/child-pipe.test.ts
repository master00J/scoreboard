import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { guardChildPipes, writeWithBackpressure } from "./child-pipe";

const FRAME = Buffer.alloc(1920 * 1080 * 4, 1);

describe("een gestopte ffmpeg sluit de app niet af", () => {
  it("vangt write EOF op als ffmpeg stopt terwijl de pomp nog beeld schrijft", async () => {
    // Zoals ffmpeg bij een verkeerde geluidsbron: het leest niets en stopt kort na de start.
    const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(1), 150)"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const errors: string[] = [];
    guardChildPipes(child, (pipe, error) => errors.push(`${pipe}:${error.message}`));

    const unexpected: unknown[] = [];
    const onUncaught = (error: unknown) => unexpected.push(error);
    process.on("uncaughtException", onUncaught);
    try {
      const closed = once(child, "close");
      const pump = setInterval(() => {
        if (child.stdin.writable) void writeWithBackpressure(child.stdin, FRAME).catch(() => undefined);
      }, 10);
      await closed;
      await new Promise((resolve) => setTimeout(resolve, 200));
      clearInterval(pump);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
    expect(unexpected).toEqual([]);
    expect(errors.some((error) => error.startsWith("stdin:"))).toBe(true);
  });

  it("blijft niet eeuwig op drain wachten als de pijp sluit", async () => {
    const slow = new Writable({ highWaterMark: 1, write: () => undefined });
    const pending = writeWithBackpressure(slow, Buffer.from("frame"));
    slow.destroy();
    await expect(pending).rejects.toThrow();
  });

  it("schrijft gewoon door zolang er plaats is", async () => {
    const pipe = new PassThrough();
    const chunks: Buffer[] = [];
    pipe.on("data", (chunk: Buffer) => chunks.push(chunk));
    await writeWithBackpressure(pipe, Buffer.from("abc"));
    await writeWithBackpressure(pipe, Buffer.from("def"));
    expect(Buffer.concat(chunks).toString()).toBe("abcdef");
  });

  it("weigert meteen als de pijp al dicht is", async () => {
    const pipe = new PassThrough();
    pipe.end();
    await expect(writeWithBackpressure(pipe, Buffer.from("x"))).rejects.toThrow();
  });
});
