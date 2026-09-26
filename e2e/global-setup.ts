import { writeFileSync } from "node:fs";

import { describeOffDays, pinWorkingDay } from "./calendar";
import { istDate, RUN_STATE_FILE, wallClock } from "./run-state";

/**
 * Runs once before the build and the projects (2.6).
 *
 * 1. **The stack is ready.** `pnpm db:reset` restarts the auth and realtime containers and
 *    the database itself, and PostgREST reconnects on its own schedule. A run started straight
 *    after a reset once failed all three `setup` sign-ins with INTERNAL (2026-09-24). Waiting
 *    here is a readiness check, not a timeout: each probe asks the service to do the thing the
 *    suite needs (GoTrue answers, PostgREST reaches Postgres, Mailpit accepts API calls) and a
 *    stack that never comes fails within two minutes with the reason.
 * 2. **The IST date is recorded**, so the teardown can say when a run crossed midnight IST
 *    (18:30 UTC): the saved Admin and Staff sessions are then gated again for the new day and
 *    every one of their tests fails in a cascade that looks like nothing in the code (seen on
 *    2026-09-24 at 00:00 IST, 36 failures).
 * 3. **Today is a working day** (`pinWorkingDay`, e2e/calendar.ts): a weekly day off that falls
 *    on today moves to tomorrow's weekday and a holiday dated today is removed, so the specs
 *    that assume a working day (the Owner's board, the strip, the gate) hold on the seed's
 *    Sunday too; `settings.spec` asserts the pinned days.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and _PUBLISHABLE_KEY are needed (.env.local or CI)");
  }
  const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

  await waitFor("GoTrue", async () => {
    const response = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
    return response.status === 200;
  });
  await waitFor("PostgREST (connected to Postgres)", async () => {
    // Any answer PostgREST computes itself proves the database connection: a 503 means it is
    // still reconnecting after the reset, a network error that Kong or PostgREST is not up.
    const response = await fetch(`${url}/rest/v1/rpc/member_self_status`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: "{}",
    });
    return response.status < 500;
  });
  await waitFor("Mailpit", async () => (await fetch(`${mailpit}/api/v1/info`)).status === 200);

  const now = wallClock();
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SECRET_KEY is needed to pin today as a working day");
  const { configured, pinned } = await pinWorkingDay(url, serviceKey, now, istDate(now));
  if (pinned.join() !== [...configured].sort((a, b) => a - b).join()) {
    console.warn(
      `e2e: today is a weekly day off (${describeOffDays(configured)}); running with ${describeOffDays(pinned)} off instead.`,
    );
  }

  writeFileSync(RUN_STATE_FILE, JSON.stringify({ startedOnIST: istDate(now) }));
}

async function waitFor(what: string, ready: () => Promise<boolean>): Promise<void> {
  const deadline = wallClock().getTime() + 120_000;
  let lastError = "";
  while (wallClock().getTime() < deadline) {
    try {
      if (await ready()) return;
      lastError = "not ready yet";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `${what} did not become ready within 2 minutes (${lastError}). Is the local stack up (pnpm db:start)?`,
  );
}
