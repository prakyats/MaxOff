import { createTransport, type init } from "@sentry/nextjs";

// `@sentry/nextjs` does not re-export the transport types and `@sentry/core` is not a direct
// dependency, so they are derived from the `transport` option of `Sentry.init`.
type TransportFactory = NonNullable<NonNullable<Parameters<typeof init>[0]>["transport"]>;
type BaseTransportOptions = Parameters<TransportFactory>[0];
type Transport = ReturnType<TransportFactory>;
type MakeRequest = Parameters<typeof createTransport>[1];
type TransportRequest = Parameters<MakeRequest>[0];
type TransportMakeRequestResponse = Awaited<ReturnType<MakeRequest>>;
export type SentryEnvelope = Parameters<Transport["send"]>[0];

/**
 * Sends envelopes with the platform `fetch` instead of the Node SDK's default `node:https`
 * transport. On Cloudflare Workers (`nodejs_compat`) that default never completes: the first
 * staging runs of `/diagnostics/sentry` showed "Flushing events..." followed by "Done flushing
 * events" exactly at the 2 s flush timeout and Sentry received nothing. `fetch` is native on the
 * Worker and is what `@sentry/cloudflare` itself uses. Shape follows `@sentry/browser`'s
 * `makeFetchTransport`, minus the browser-only `keepalive` handling.
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
