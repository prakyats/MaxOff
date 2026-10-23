import { describe, expect, it, vi } from "vitest";

import { orNone } from "./or-none";

const NO_BAND = { endpoints: [] as string[], band: null };

describe("orNone", () => {
  it("passes the value through when the read succeeds, without reporting", async () => {
    const report = vi.fn();
    const status = { endpoints: ["https://push.example/1"], band: "not_enabled" };
    await expect(orNone(Promise.resolve(status), NO_BAND, report)).resolves.toBe(status);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a failed push-status read once and answers no band", async () => {
    const report = vi.fn();
    const failure = new Error("push_status_own: upstream timeout");
    await expect(orNone(Promise.reject(failure), NO_BAND, report)).resolves.toBe(NO_BAND);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure);
  });

  it("reports a failed own-today read and answers no prompt (null)", async () => {
    const report = vi.fn();
    await expect(orNone(Promise.reject(new Error("fetch failed")), null, report)).resolves.toBe(
      null,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("still fails when the reporter rethrows (a framework signal, not a read error)", async () => {
    const signal = new Error("NEXT_REDIRECT");
    const rethrow = (error: unknown) => {
      throw error;
    };
    await expect(orNone(Promise.reject(signal), null, rethrow)).rejects.toBe(signal);
  });
});
