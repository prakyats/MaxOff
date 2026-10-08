import type { Result } from "@/core/errors/result";

/**
 * The client half of a **background call** (ARCHITECTURE §4.4): what the app sends on its own,
 * from an effect, a timer, a Realtime callback or a lazy import, goes to a route handler
 * (`core/http/background-route.ts`) with a plain `fetch`, never as a server action. Next queues
 * a server action sent during a navigation behind it and holds the new page until the action
 * answers (CI run 37118131079); a plain request is never part of the router's queue.
 *
 * Same origin with the session cookies, JSON in and out. Resolves with the handler's `Result`
 * and never rejects: an unreachable server or an answer that is not a `Result` is a failed one
 * (`INTERNAL`), for the caller to treat like any other failure.
 *
 * Only a type is imported from `core/errors`: the codes' messages live in a module the first load
 * shares, and importing it here split it out of that load (+67 bytes on `/today`, 2026-10-06).
 */

/** No answer the app can read: the network, or something other than a handler in between. */
const UNREACHABLE: Result<never> = {
  ok: false,
  error: {
    code: "INTERNAL",
    message: "Couldn't reach MaxOff. Check the connection and try again.",
  },
};

/** A query's values: a list becomes one repeated key (`?member=a&member=b`). */
export type BackgroundQuery = Readonly<Record<string, string | readonly string[]>>;

function isResult(value: unknown): value is Result<unknown> {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  const { ok } = value as { ok: unknown };
  if (ok === true) return "data" in value;
  if (ok !== false || !("error" in value)) return false;
  const { error } = value as { error: unknown };
  return typeof error === "object" && error !== null && "code" in error;
}

async function send<T>(url: string, init: RequestInit): Promise<Result<T>> {
  try {
    const response = await fetch(url, { ...init, credentials: "same-origin" });
    const body: unknown = await response.json();
    return isResult(body) ? (body as Result<T>) : UNREACHABLE;
  } catch {
    return UNREACHABLE;
  }
}

/** The address of a background read: `path` with `query` (lists as repeated keys). */
export function backgroundUrl(path: string, query: BackgroundQuery = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of typeof value === "string" ? [value] : value) params.append(key, item);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** A background read (`GET`), never cached. */
export function getInBackground<T>(path: string, query?: BackgroundQuery): Promise<Result<T>> {
  return send<T>(backgroundUrl(path, query), {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
}

/**
 * A background write (`POST`, JSON). `keepalive` so a write the page is being left behind (a
 * read receipt, the app's report) still reaches the server.
 */
export function postInBackground<T>(path: string, body: unknown): Promise<Result<T>> {
  return send<T>(path, {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}
