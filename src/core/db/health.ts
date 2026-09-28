import "server-only";

import { createServiceSupabase } from "./service";

/** How long `/api/health` waits for the database before answering 503. */
export const HEALTH_TIMEOUT_MS = 5_000;

/**
 * One cheap round trip to the database (3c.1): a `HEAD` count of `organizations`, which holds
 * one row. It returns no data, only whether Postgres answered. `/api/health` calls it for
 * UptimeRobot, so a free Supabase project that would otherwise pause after 7 idle days
 * (ADR-0003) is touched every few minutes, and the monitor sees the database, not just the
 * Worker. The service client is used because nothing else is guaranteed a grant on an
 * unauthenticated request; the query itself reveals nothing (`head: true`).
 */
/** The one query the probe makes, as a shape the test can fake without a database. */
export interface HealthClient {
  from(table: "organizations"): {
    select(
      columns: "id",
      options: { count: "exact"; head: true },
    ): { abortSignal(signal: AbortSignal): PromiseLike<{ error: unknown }> };
  };
}

export async function databaseReachable(
  client?: HealthClient,
  timeoutMs: number = HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Created inside the guard, not as a default argument: a missing or malformed
    // `SUPABASE_SECRET_KEY` throws on creation, and that is a 503 like any other unreachable
    // database, never a 500 from the route.
    const { error } = await (client ?? createServiceSupabase())
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .abortSignal(controller.signal);
    return error === null;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
