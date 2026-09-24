import type { Result } from "@/core/errors";

/**
 * POSTs JSON with `keepalive`, so the request survives the page being hidden, closed or left
 * (the delayed send behind Undo, WORKFLOWS §1 "Settled in 2.4"), and reads the handler's `Result`.
 * A network failure rejects; the caller turns that into the row's error.
 */
export async function postKeepalive<T>(url: string, body: unknown): Promise<Result<T>> {
  const response = await fetch(url, {
    method: "POST",
    keepalive: true,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Result<T>;
}
