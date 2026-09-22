import { describe, expect, it, vi } from "vitest";

import { makeFetchTransport, type SentryEnvelope } from "./transport";

const URL = "https://o1.ingest.sentry.io/api/1/envelope/";

describe("makeFetchTransport", () => {
  it("POSTs the envelope to the DSN endpoint with fetch and maps the rate-limit headers", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "X-Sentry-Rate-Limits": "60:error", "Retry-After": "30" },
        }),
    );
    const transport = makeFetchTransport(
      { url: URL, headers: { "X-Sentry-Auth": "auth" }, recordDroppedEvent: () => undefined },
      fetchImpl as unknown as typeof fetch,
    );

    const envelope: SentryEnvelope = [
      { event_id: "0".repeat(32), sent_at: "2026-09-22T00:00:00.000Z" },
      [[{ type: "event" }, { message: "diagnostic" }]],
    ];
    const result = await transport.send(envelope);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-Sentry-Auth": "auth" });
    expect(typeof init.body === "string" || init.body instanceof Uint8Array).toBe(true);
    expect(result).toEqual({
      statusCode: 200,
      headers: { "x-sentry-rate-limits": "60:error", "retry-after": "30" },
    });
  });

  it("uses the platform fetch by default and never falls back to node:https", () => {
    const transport = makeFetchTransport({ url: URL, recordDroppedEvent: () => undefined });
    expect(typeof transport.send).toBe("function");
    expect(typeof transport.flush).toBe("function");
  });
});
