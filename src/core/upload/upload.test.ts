import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { Md5 } from "./md5";
import {
  CHUNK_UNIT,
  SessionGoneError,
  type UploadFetch,
  uploadToSession,
  UploadAbortedError,
} from "./session-upload";

function md5Of(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

function bytes(n: number, seed = 7): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i += 1) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe("Md5", () => {
  it("matches Node's MD5 for the RFC examples and for odd chunkings", () => {
    const enc = new TextEncoder();
    expect(new Md5().hex()).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(new Md5().update(enc.encode("abc")).hex()).toBe("900150983cd24fb0d6963f7d28e17f72");
    const data = bytes(200_003);
    const whole = md5Of(data);
    for (const step of [1, 63, 64, 65, 4096, 100_000]) {
      const md5 = new Md5();
      for (let i = 0; i < data.length; i += step) md5.update(data.subarray(i, i + step));
      expect(md5.hex()).toBe(whole);
    }
  });

  it("refuses more bytes once finished", () => {
    const md5 = new Md5();
    md5.hex();
    expect(() => md5.update(new Uint8Array(1))).toThrow();
  });
});

/** A fake Google session that keeps what it receives and can be told to misbehave. */
function fakeSession(
  size: number,
  opts: { keepShort?: number; failTimes?: number; goneAfter?: number; startAt?: number } = {},
) {
  const held: Uint8Array = new Uint8Array(size);
  let got = opts.startAt ?? 0;
  let failures = opts.failTimes ?? 0;
  let calls = 0;
  const ranges: string[] = [];
  const fetchImpl: UploadFetch = async (_url, init) => {
    calls += 1;
    const range = (init.headers as Record<string, string>)["content-range"] ?? "";
    ranges.push(range);
    if (opts.goneAfter !== undefined && calls > opts.goneAfter)
      return new Response(null, { status: 404 });
    const ask = /^bytes \*\/(\d+)$/.exec(range);
    if (ask) {
      if (got >= size && size > 0) return Response.json({ id: "drive-1" }, { status: 200 });
      if (size === 0) return Response.json({ id: "drive-0" }, { status: 201 });
      return new Response(null, {
        status: 308,
        headers: got > 0 ? { range: `bytes=0-${got - 1}` } : {},
      });
    }
    if (failures > 0) {
      failures -= 1;
      return new Response(null, { status: 503 });
    }
    const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
    if (!m) return new Response(null, { status: 400 });
    const start = Number(m[1]);
    const body = init.body as Uint8Array;
    if (start !== got) return new Response(null, { status: 400 });
    let keep = body.length;
    if (opts.keepShort && start === 0) keep = Math.min(keep, opts.keepShort);
    held.set(body.subarray(0, keep), start);
    got = start + keep;
    if (got >= size) return Response.json({ id: "drive-1" }, { status: 200 });
    return new Response(null, { status: 308, headers: { range: `bytes=0-${got - 1}` } });
  };
  return { fetchImpl, held: () => held, ranges, calls: () => calls };
}

const noWait = async () => {};

describe("uploadToSession", () => {
  it("sends a fresh file in 256 KiB-multiple chunks, and hashes it", async () => {
    const data = bytes(3 * CHUNK_UNIT + 123);
    const session = fakeSession(data.length);
    const progress: number[] = [];
    const result = await uploadToSession({
      file: new Blob([data]),
      sessionUri: "s",
      fetchImpl: session.fetchImpl,
      chunkSize: CHUNK_UNIT + 5,
      fresh: true,
      onProgress: (n) => progress.push(n),
      sleep: noWait,
    });
    expect(result).toEqual({ fileId: "drive-1", md5: md5Of(data) });
    expect(session.held()).toEqual(data);
    expect(session.ranges[0]).toBe(`bytes 0-${CHUNK_UNIT - 1}/${data.length}`);
    expect(progress.at(-1)).toBe(data.length);
  });

  it("resumes where Google stopped, with no MD5 (size check only)", async () => {
    const data = bytes(2 * CHUNK_UNIT);
    const session = fakeSession(data.length, { startAt: CHUNK_UNIT });
    // The fake already "holds" the first half; give it those bytes.
    const result = await uploadToSession({
      file: new Blob([data]),
      sessionUri: "s",
      fetchImpl: session.fetchImpl,
      sleep: noWait,
    });
    expect(result.md5).toBeNull();
    expect(session.ranges[0]).toBe(`bytes */${data.length}`);
    expect(session.ranges[1]).toBe(`bytes ${CHUNK_UNIT}-${2 * CHUNK_UNIT - 1}/${data.length}`);
  });

  it("retries a failing chunk and still hashes the file whole", async () => {
    const data = bytes(CHUNK_UNIT * 2);
    const session = fakeSession(data.length, { failTimes: 3 });
    const result = await uploadToSession({
      file: new Blob([data]),
      sessionUri: "s",
      fetchImpl: session.fetchImpl,
      fresh: true,
      chunkSize: CHUNK_UNIT,
      sleep: noWait,
    });
    expect(result.md5).toBe(md5Of(data));
    expect(session.held()).toEqual(data);
  });

  it("drops the MD5 when Google kept fewer bytes than were sent", async () => {
    const data = bytes(CHUNK_UNIT * 2);
    const session = fakeSession(data.length, { keepShort: CHUNK_UNIT / 2 });
    const result = await uploadToSession({
      file: new Blob([data]),
      sessionUri: "s",
      fetchImpl: session.fetchImpl,
      fresh: true,
      chunkSize: CHUNK_UNIT,
      sleep: noWait,
    });
    expect(result.md5).toBeNull();
    expect(session.held()).toEqual(data);
  });

  it("returns the file when the session says it already finished", async () => {
    const data = bytes(10);
    const session = fakeSession(data.length, { startAt: 10 });
    await expect(
      uploadToSession({
        file: new Blob([data]),
        sessionUri: "s",
        fetchImpl: session.fetchImpl,
        sleep: noWait,
      }),
    ).resolves.toEqual({
      fileId: "drive-1",
      md5: null,
    });
  });

  it("sends an empty file", async () => {
    const session = fakeSession(0);
    const result = await uploadToSession({
      file: new Blob([]),
      sessionUri: "s",
      fetchImpl: session.fetchImpl,
      fresh: true,
      sleep: noWait,
    });
    expect(result).toEqual({ fileId: "drive-0", md5: "d41d8cd98f00b204e9800998ecf8427e" });
  });

  it("says when the session is gone, and when it was stopped", async () => {
    const data = bytes(CHUNK_UNIT * 2);
    const gone = fakeSession(data.length, { goneAfter: 1 });
    await expect(
      uploadToSession({
        file: new Blob([data]),
        sessionUri: "s",
        fetchImpl: gone.fetchImpl,
        fresh: true,
        chunkSize: CHUNK_UNIT,
        sleep: noWait,
      }),
    ).rejects.toBeInstanceOf(SessionGoneError);
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadToSession({
        file: new Blob([data]),
        sessionUri: "s",
        fetchImpl: fakeSession(data.length).fetchImpl,
        signal: controller.signal,
        sleep: noWait,
      }),
    ).rejects.toBeInstanceOf(UploadAbortedError);
  });

  it("carries on after the network drops (fetch throws) and comes back", async () => {
    const data = bytes(CHUNK_UNIT * 2);
    const session = fakeSession(data.length);
    let drops = 2;
    const flaky: UploadFetch = async (url, init) => {
      if (drops > 0) {
        drops -= 1;
        throw new TypeError("Failed to fetch");
      }
      return session.fetchImpl(url, init);
    };
    const result = await uploadToSession({
      file: new Blob([data]),
      sessionUri: "s",
      fetchImpl: flaky,
      fresh: true,
      chunkSize: CHUNK_UNIT,
      sleep: noWait,
    });
    expect(result.md5).toBe(md5Of(data));
  });
});
