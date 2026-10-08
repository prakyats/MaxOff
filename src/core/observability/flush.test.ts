import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  flush: vi.fn(async () => true),
  captureException: vi.fn(() => "event-1"),
  captureMessage: vi.fn(() => "event-2"),
}));
vi.mock("@sentry/core", () => sdk);

import { captureException, captureMessage } from "./capture";
import { FLUSH_TIMEOUT_MS, flushInBackground } from "./flush";

const CONTEXT = Symbol.for("__cloudflare-context__");

/** What OpenNext puts behind the symbol for the request in flight. */
function inRequest() {
  const waitUntil = vi.fn();
  Object.defineProperty(globalThis, CONTEXT, {
    configurable: true,
    get: () => ({ env: {}, ctx: { waitUntil }, cf: {} }),
  });
  return waitUntil;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, CONTEXT);
  vi.clearAllMocks();
});

describe("flushInBackground (ADR-0014)", () => {
  it("hands a flush to the request's waitUntil, so the Worker sends before it stops", async () => {
    const waitUntil = inRequest();
    flushInBackground();
    expect(sdk.flush).toHaveBeenCalledWith(FLUSH_TIMEOUT_MS);
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });

  it("never rejects into waitUntil, even when the flush fails", async () => {
    const waitUntil = inRequest();
    sdk.flush.mockRejectedValueOnce(new Error("network"));
    flushInBackground();
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });

  it("does nothing outside a request (tests, the build)", () => {
    flushInBackground();
    expect(sdk.flush).not.toHaveBeenCalled();
  });
});

describe("server captures", () => {
  it("captureException reports, flushes in the background and returns the event id", () => {
    const waitUntil = inRequest();
    const error = new Error("boom");
    expect(captureException(error)).toBe("event-1");
    expect(sdk.captureException).toHaveBeenCalledWith(error, undefined);
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("captureMessage does the same with its level", () => {
    const waitUntil = inRequest();
    expect(captureMessage("left behind", "error")).toBe("event-2");
    expect(sdk.captureMessage).toHaveBeenCalledWith("left behind", "error");
    expect(waitUntil).toHaveBeenCalledOnce();
  });
});
