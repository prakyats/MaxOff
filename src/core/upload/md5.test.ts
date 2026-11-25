import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { Md5 } from "./md5";

function nodeMd5(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

describe("the incremental MD5", () => {
  it("matches the known vectors", () => {
    const text = (s: string) => new TextEncoder().encode(s);
    for (const input of [
      "",
      "a",
      "abc",
      "message digest",
      "The quick brown fox jumps over the lazy dog",
    ]) {
      expect(new Md5().update(text(input)).hex()).toBe(nodeMd5(text(input)));
    }
  });

  it("gives the same answer however the bytes are split", () => {
    const bytes = Uint8Array.from({ length: 1_000_003 }, (_, i) => (i * 31 + 7) & 0xff);
    const md5 = new Md5();
    for (let at = 0, step = 1; at < bytes.length; at += step, step = (step * 7 + 3) % 70_001 || 1) {
      md5.update(bytes.subarray(at, Math.min(at + step, bytes.length)));
    }
    expect(md5.hex()).toBe(nodeMd5(bytes));
  });
});
