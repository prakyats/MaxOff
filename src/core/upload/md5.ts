/**
 * An incremental MD5 (RFC 1321) for the browser upload engine: fed chunk by chunk as the bytes
 * go to Google, so a multi-gigabyte file is never held in memory. Drive reports each binary
 * file's `md5Checksum`; the Worker compares the two (v4.5 plan F1/F2) to tell a damaged
 * transfer from a good one. MD5 is used here only as a transfer checksum, never for security.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
);

export class Md5 {
  private a = 0x67452301;
  private b = 0xefcdab89;
  private c = 0x98badcfe;
  private d = 0x10325476;
  private readonly buffer = new Uint8Array(64);
  private buffered = 0;
  private length = 0;
  private finished = false;

  update(bytes: Uint8Array): this {
    if (this.finished) throw new Error("This MD5 is already finished.");
    this.length += bytes.length;
    let offset = 0;
    if (this.buffered > 0) {
      const take = Math.min(64 - this.buffered, bytes.length);
      this.buffer.set(bytes.subarray(0, take), this.buffered);
      this.buffered += take;
      offset = take;
      if (this.buffered < 64) return this;
      this.block(this.buffer, 0);
      this.buffered = 0;
    }
    for (; offset + 64 <= bytes.length; offset += 64) this.block(bytes, offset);
    if (offset < bytes.length) {
      this.buffer.set(bytes.subarray(offset), 0);
      this.buffered = bytes.length - offset;
    }
    return this;
  }

  /** The 32 lower-case hex characters Drive's `md5Checksum` uses. */
  hex(): string {
    if (!this.finished) {
      const bits = this.length * 8;
      const padLength = (this.buffered < 56 ? 56 : 120) - this.buffered;
      const pad = new Uint8Array(padLength + 8);
      pad[0] = 0x80;
      const view = new DataView(pad.buffer);
      view.setUint32(padLength, bits >>> 0, true);
      view.setUint32(padLength + 4, Math.floor(bits / 2 ** 32), true);
      const length = this.length;
      this.update(pad);
      this.length = length;
      this.finished = true;
    }
    const out = new DataView(new ArrayBuffer(16));
    [this.a, this.b, this.c, this.d].forEach((word, i) => out.setUint32(i * 4, word, true));
    return Array.from(new Uint8Array(out.buffer), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  private block(bytes: Uint8Array, offset: number): void {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) {
      const p = offset + i * 4;
      m[i] =
        ((bytes[p] ?? 0) |
          ((bytes[p + 1] ?? 0) << 8) |
          ((bytes[p + 2] ?? 0) << 16) |
          ((bytes[p + 3] ?? 0) << 24)) >>>
        0;
    }
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = d;
      d = c;
      c = b;
      const sum = (a + f + (K[i] ?? 0) + (m[g] ?? 0)) >>> 0;
      const shift = S[i] ?? 0;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
      a = next;
    }
    this.a = (this.a + a) >>> 0;
    this.b = (this.b + b) >>> 0;
    this.c = (this.c + c) >>> 0;
    this.d = (this.d + d) >>> 0;
  }
}
