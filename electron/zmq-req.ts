import net from "node:net";

/** ZMTP 3.1 greeting (NULL), compatible with libzmq. */
function greeting(): Buffer {
  const buf = Buffer.alloc(64);
  buf[0] = 0xff;
  buf[8] = 0x01;
  buf[9] = 0x7f;
  buf[10] = 3;
  buf[11] = 1;
  buf.write("NULL", 12, "ascii");
  return buf;
}

function readyCommand(): Buffer {
  const props = Buffer.concat([property("Socket-Type", "DEALER"), property("Identity", "")]);
  const body = Buffer.concat([Buffer.from([5]), Buffer.from("READY"), props]);
  return commandFrame(body);
}

function property(name: string, value: string): Buffer {
  const n = Buffer.from(name, "utf8");
  const v = Buffer.from(value, "utf8");
  const out = Buffer.alloc(1 + n.length + 4 + v.length);
  out[0] = n.length;
  n.copy(out, 1);
  out.writeUInt32BE(v.length, 1 + n.length);
  v.copy(out, 5 + n.length);
  return out;
}

function commandFrame(body: Buffer): Buffer {
  if (body.length < 256) return Buffer.concat([Buffer.from([0x04, body.length]), body]);
  const header = Buffer.alloc(9);
  header[0] = 0x06;
  header.writeBigUInt64BE(BigInt(body.length), 1);
  return Buffer.concat([header, body]);
}

function dataFrame(body: Buffer, more = false): Buffer {
  if (body.length < 256) {
    return Buffer.concat([Buffer.from([more ? 0x01 : 0x00, body.length]), body]);
  }
  const header = Buffer.alloc(9);
  header[0] = more ? 0x03 : 0x02;
  header.writeBigUInt64BE(BigInt(body.length), 1);
  return Buffer.concat([header, body]);
}

function commandName(body: Buffer): string | null {
  if (body.length < 1) return null;
  const n = body[0]!;
  if (n < 1 || n > 32 || body.length < 1 + n) return null;
  const name = body.subarray(1, 1 + n).toString("ascii");
  return /^[A-Z]{3,12}$/.test(name) ? name : null;
}

function pongFor(ping: Buffer): Buffer {
  const n = ping[0]!;
  const rest = ping.subarray(1 + n);
  return commandFrame(Buffer.concat([Buffer.from([4]), Buffer.from("PONG"), rest]));
}

type WireFrame = { flags: number; body: Buffer };

class FrameReader {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
  }

  readGreeting(): Buffer | null {
    if (this.buf.length < 64) return null;
    const g = this.buf.subarray(0, 64);
    this.buf = this.buf.subarray(64);
    return g;
  }

  readFrame(): WireFrame | null {
    if (this.buf.length < 2) return null;
    const flags = this.buf[0]!;
    const long = (flags & 0x02) !== 0;
    if (long) {
      if (this.buf.length < 9) return null;
      const size = Number(this.buf.readBigUInt64BE(1));
      if (this.buf.length < 9 + size) return null;
      const body = this.buf.subarray(9, 9 + size);
      this.buf = this.buf.subarray(9 + size);
      return { flags, body };
    }
    const size = this.buf[1]!;
    if (this.buf.length < 2 + size) return null;
    const body = this.buf.subarray(2, 2 + size);
    this.buf = this.buf.subarray(2 + size);
    return { flags, body };
  }
}

/** DEALER → FFmpeg azmq (ZMQ_REP). Leeg envelope-frame + body. */
export function sendZmqReq(host: string, port: number, message: string, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const reader = new FrameReader();
    let stage: "greeting" | "ready" | "reply" = "greeting";
    let replyParts: Buffer[] = [];
    let settled = false;

    const finish = (err: Error | null, reply?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(reply ?? "");
    };

    const timer = setTimeout(() => finish(new Error("zmq timeout")), timeoutMs);

    const sendRequest = () => {
      socket.write(dataFrame(Buffer.alloc(0), true));
      socket.write(dataFrame(Buffer.from(message, "utf8")));
    };

    socket.once("connect", () => {
      socket.write(greeting());
      socket.write(readyCommand());
    });

    socket.on("data", (chunk) => {
      reader.push(chunk);
      if (stage === "greeting") {
        if (!reader.readGreeting()) return;
        stage = "ready";
      }
      while (stage === "ready") {
        const frame = reader.readFrame();
        if (!frame) return;
        if (frame.flags & 0x04) {
          const name = commandName(frame.body);
          if (name === "PING") {
            socket.write(pongFor(frame.body));
            continue;
          }
        }
        sendRequest();
        stage = "reply";
        break;
      }
      while (stage === "reply") {
        const frame = reader.readFrame();
        if (!frame) return;
        if (frame.flags & 0x04) {
          const name = commandName(frame.body);
          if (name === "PING") {
            socket.write(pongFor(frame.body));
            continue;
          }
        }
        if (frame.body.length > 0) replyParts.push(frame.body);
        if (frame.flags & 0x01) continue;
        finish(null, Buffer.concat(replyParts).toString("utf8"));
        return;
      }
    });

    socket.on("error", (err) => finish(err));
    socket.on("close", () => {
      if (!settled) finish(new Error("zmq closed"));
    });
  });
}
