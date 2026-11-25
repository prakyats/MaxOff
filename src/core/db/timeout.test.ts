import { describe, expect, it, vi } from "vitest";

import { DB_TIMEOUT_MARKER, isDbTimeout, withTimeout } from "./timeout";

describe("withTimeout", () => {
  it("fails a request that never answers as the database timeout", async () => {
    vi.useFakeTimers();
    const never: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const request = withTimeout(never, 50)("https://db.example/rest/v1/x");
    const caught = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60);
    const error = await caught;
    expect(error).toMatchObject({ name: "TimeoutError", message: DB_TIMEOUT_MARKER });
    expect(isDbTimeout(error)).toBe(true);
    vi.useRealTimers();
  });

  it("passes an answer through, and the caller's own abort as it is", async () => {
    const ok: typeof fetch = async () => new Response("{}");
    await expect(withTimeout(ok, 50)("https://db.example")).resolves.toBeInstanceOf(Response);
    const controller = new AbortController();
    const aborting: typeof fetch = async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    };
    await expect(
      withTimeout(aborting, 50)("https://db.example", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("knows the timeout as postgrest-js reports it", () => {
    expect(isDbTimeout({ message: `TimeoutError: ${DB_TIMEOUT_MARKER}`, code: "" })).toBe(true);
    expect(isDbTimeout({ message: "TypeError: fetch failed", code: "" })).toBe(false);
  });
});
