import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backgroundUrl, getInBackground, postInBackground } from "./background";

/** ARCHITECTURE §4.4: the app's own calls are plain requests that never throw to the caller. */
describe("background calls (core/http/background)", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a read's address: a list is one repeated key, nothing else is added", () => {
    expect(backgroundUrl("/api/x")).toBe("/api/x");
    expect(backgroundUrl("/api/x", { member: ["a", "b"], day: "2026-10-06" })).toBe(
      "/api/x?member=a&member=b&day=2026-10-06",
    );
    expect(backgroundUrl("/api/x", { q: "a&b=c" })).toBe("/api/x?q=a%26b%3Dc");
  });

  it("a read is a same-origin GET, never cached, answering the handler's Result", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: { count: 3, countedAt: 1 } }));
    const result = await getInBackground<{ count: number }>("/api/notifications/unread");
    expect(result).toEqual({ ok: true, data: { count: 3, countedAt: 1 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/notifications/unread");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin" });
  });

  it("a write is a same-origin JSON POST with keepalive", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, data: null }));
    const result = await postInBackground<null>("/api/tasks/read", { taskId: "t1" });
    expect(result).toEqual({ ok: true, data: null });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/tasks/read");
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      body: JSON.stringify({ taskId: "t1" }),
    });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("a refusal comes back as the handler's failed Result, whatever the status", async () => {
    const refused = { ok: false, error: { code: "INVALID_STATE", message: "Removed." } };
    fetchMock.mockResolvedValue(Response.json(refused, { status: 409 }));
    expect(await postInBackground("/api/push/subscription", {})).toEqual(refused);
  });

  it("never rejects: no network, a body that is not JSON, or JSON that is not a Result", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await getInBackground("/api/x")).toMatchObject({
      ok: false,
      error: { code: "INTERNAL" },
    });
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    expect(await postInBackground("/api/x", {})).toMatchObject({
      ok: false,
      error: { code: "INTERNAL" },
    });
    for (const body of [{ id: "s1" }, { ok: true }, { ok: false, error: "x" }, null]) {
      fetchMock.mockResolvedValueOnce(Response.json(body));
      expect(await getInBackground("/api/x")).toMatchObject({
        ok: false,
        error: { code: "INTERNAL" },
      });
    }
  });
});
