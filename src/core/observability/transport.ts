import {
  createTransport,
  type BaseTransportOptions,
  type Envelope,
  type Transport,
  type TransportMakeRequestResponse,
  type TransportRequest,
} from "@sentry/core";

export type SentryEnvelope = Envelope;

/**
 * Sends envelopes with the platform `fetch` instead of the Node SDK's default `node:https`
 * transport. On Cloudflare Workers (`nodejs_compat`) that default never completes: the first
 * staging runs of `/diagnostics/sentry` showed "Flushing events..." followed by "Done flushing
 * events" exactly at the 2 s flush timeout and Sentry received nothing. `fetch` is native on the
 * Worker and is what `@sentry/cloudflare` itself uses. Shape follows `@sentry/browser`'s
 * `makeFetchTransport`, minus the browser-only `keepalive` handling.
 *
 * Kept with the switch to `@sentry/cloudflare` (ADR-0014): it sends at once, where that SDK's own
 * transport holds every envelope until a flush, and it is the transport proven on staging.
 */
export function makeFetchTransport(
  options: BaseTransportOptions,
  fetchImpl: typeof fetch = fetch,
): Transport {
  async function makeRequest(request: TransportRequest): Promise<TransportMakeRequestResponse> {
    const response = await fetchImpl(options.url, {
      method: "POST",
      // A fresh ArrayBuffer-backed view: `fetch` rejects a `Uint8Array<ArrayBufferLike>`.
      body: typeof request.body === "string" ? request.body : new Uint8Array(request.body),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    return {
      statusCode: response.status,
      headers: {
        "x-sentry-rate-limits": response.headers.get("X-Sentry-Rate-Limits"),
        "retry-after": response.headers.get("Retry-After"),
      },
    };
  }
  return createTransport(options, makeRequest);
}
