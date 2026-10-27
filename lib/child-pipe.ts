import type { Readable, Writable } from "node:stream";

type PipedChild = {
  stdin?: Writable | null;
  stdout?: Readable | null;
  stderr?: Readable | null;
};

/**
 * Vangt fouten op de pijpen van een kindproces (ffmpeg, de GoXLR-helper) op.
 *
 * Stopt ffmpeg terwijl de app nog beeld schrijft, dan krijgt stdin een `write EOF` of `EPIPE`. Zonder
 * luisteraar wordt dat een uncaughtException, en die sluit de hele app af, stadionscherm inbegrepen.
 * Een mislukte livestream mag nooit meer kosten dan de livestream zelf.
 */
export function guardChildPipes(child: PipedChild, onError: (pipe: "stdin" | "stdout" | "stderr", error: Error) => void) {
  for (const pipe of ["stdin", "stdout", "stderr"] as const) {
    child[pipe]?.on("error", (error: Error) => onError(pipe, error));
  }
}

/**
 * Schrijft één buffer en wacht bij een volle pijp tot er weer plaats is. Sluit de pijp of faalt het
 * schrijven, dan eindigt de belofte toch: anders bleef de beeldpomp eeuwig op `drain` wachten.
 */
export function writeWithBackpressure(stdin: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!stdin.writable) {
      reject(new Error("pijp is dicht"));
      return;
    }
    let settled = false;
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      stdin.off("drain", onDrain);
      stdin.off("close", onClose);
      stdin.off("error", onFail);
      if (error) reject(error);
      else resolve();
    };
    const onDrain = () => finish();
    const onClose = () => finish(new Error("pijp gesloten"));
    const onFail = (error: Error) => finish(error);
    stdin.on("close", onClose);
    stdin.on("error", onFail);
    let ok = false;
    try {
      ok = stdin.write(buf, (error) => {
        if (error) finish(error);
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (ok) finish();
    else stdin.on("drain", onDrain);
  });
}
