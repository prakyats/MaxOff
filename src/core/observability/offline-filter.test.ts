import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { browserBeforeSend, isOfflineFetchFailure, OFFLINE_FETCH_MESSAGES } from "./offline-filter";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The event the browser SDK builds for a thrown error (type and value of the exception). */
function eventFor(type: string, value: string): ErrorEvent {
  return { type: undefined, exception: { values: [{ type, value }] } };
}

function typeError(message: string): EventHint {
  return { originalException: new TypeError(message) };
}

describe("isOfflineFetchFailure (MAXOFF-8/-9)", () => {
  it.each(OFFLINE_FETCH_MESSAGES)("drops a TypeError %j, online or not", (message) => {
    const event = eventFor("TypeError", message);
    expect(isOfflineFetchFailure(event, typeError(message), false)).toBe(true);
    expect(isOfflineFetchFailure(event, typeError(message), true)).toBe(true);
    expect(isOfflineFetchFailure(event, typeError(message), undefined)).toBe(true);
  });

  it("reads the event's own exception when the hint has no Error (a replayed early report)", () => {
    expect(isOfflineFetchFailure(eventFor("TypeError", "Load failed"), {}, true)).toBe(true);
    expect(
      isOfflineFetchFailure(eventFor("TypeError", "Load failed"), { originalException: "x" }, true),
    ).toBe(true);
  });

  it("drops a network message with more after it only while the browser is offline", () => {
    const message = "Failed to fetch (api.example.com)";
    const event = eventFor("TypeError", message);
    expect(isOfflineFetchFailure(event, typeError(message), false)).toBe(true);
    expect(isOfflineFetchFailure(event, typeError(message), true)).toBe(false);
    expect(isOfflineFetchFailure(event, typeError(message), undefined)).toBe(false);
  });

  it("keeps a TypeError with any other message, also offline", () => {
    const message = "Cannot read properties of undefined (reading 'id')";
    expect(isOfflineFetchFailure(eventFor("TypeError", message), typeError(message), false)).toBe(
      false,
    );
    expect(
      isOfflineFetchFailure(eventFor("TypeError", "load failed"), typeError("load failed"), false),
    ).toBe(false);
  });

  it("keeps the same words thrown as anything but a TypeError", () => {
    const hint = { originalException: new Error("Failed to fetch") };
    expect(isOfflineFetchFailure(eventFor("Error", "Failed to fetch"), hint, false)).toBe(false);
    expect(isOfflineFetchFailure(eventFor("Error", "Load failed"), {}, false)).toBe(false);
  });

  it("keeps an event with no exception (a message)", () => {
    expect(isOfflineFetchFailure({ type: undefined, message: "Failed to fetch" }, {}, false)).toBe(
      false,
    );
  });
});

describe("browserBeforeSend", () => {
  it("drops an offline fetch failure before the scrubber sees it", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const scrub = vi.fn((event: ErrorEvent) => event);
    const beforeSend = browserBeforeSend(scrub);
    expect(beforeSend(eventFor("TypeError", "Load failed"), typeError("Load failed"))).toBeNull();
    expect(scrub).not.toHaveBeenCalled();
  });

  it("hands every other event to the scrubber and returns what it returns", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const scrubbed = eventFor("TypeError", "[scrubbed]");
    const scrub = vi.fn(() => scrubbed);
    const beforeSend = browserBeforeSend(scrub);
    const event = eventFor("TypeError", "Failed to fetch (api.example.com)");
    expect(beforeSend(event, typeError("Failed to fetch (api.example.com)"))).toBe(scrubbed);
    expect(scrub).toHaveBeenCalledWith(event);
  });

  it("reads navigator.onLine when the event is sent", () => {
    const scrub = vi.fn((event: ErrorEvent) => event);
    const beforeSend = browserBeforeSend(scrub);
    const message = "NetworkError when attempting to fetch resource. (x)";
    vi.stubGlobal("navigator", { onLine: true });
    expect(beforeSend(eventFor("TypeError", message), typeError(message))).not.toBeNull();
    vi.stubGlobal("navigator", { onLine: false });
    expect(beforeSend(eventFor("TypeError", message), typeError(message))).toBeNull();
  });
});
