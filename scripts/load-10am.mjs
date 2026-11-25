#!/usr/bin/env node
// The 10:00 rush test (v7.0 unit 6; owner Q5–Q7, 14 Nov 2026; runbook docs/runbooks/load-test.md).
//
// Twenty made-up people start their day in the same minute, the way the team does at 10:00 IST,
// against **staging only** (`lib/load-guard.mjs` refuses production's app and database). Each
// person: the home screen through the Worker with their own session, `attendance_start_day` with
// their own JWT, then the home screen again. The wait is the Start day call plus that second read
// (the screen showing the started day). Then the database is asked: exactly one day and one
// `started` event per person.
//
//   node scripts/load-10am.mjs people --count 20          # make or reactivate the people
//   node scripts/load-10am.mjs run --base <staging> --count 20 [--spread 60] [--out run.json]
//   node scripts/load-10am.mjs people --count 20 --off    # deactivate them again (never deleted)
//
// Environment: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY of **staging's**
// project. Sessions are minted before the start, paced for GoTrue's sign-in limit. Run Monday to
// Saturday after 22:00 IST, never in a speed-gate window, once per night (a day starts once).
// Exit code 1 on FAIL.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";

import { assertLoadTarget, isLoadEmail, loadPerson } from "./lib/load-guard.mjs";
import {
  refusalOf,
  reportLines,
  rushWindowRefusal,
  stepSummary,
  tally,
  verdict,
} from "./lib/load-report.mjs";

const require = createRequire(import.meta.url);

const { positionals, values: args } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string" },
    count: { type: "string", default: "20" },
    spread: { type: "string", default: "60" },
    pace: { type: "string", default: "11" },
    off: { type: "boolean", default: false },
    out: { type: "string" },
  },
});
const command = positionals[0];
const count = Number(args.count);
if (!Number.isInteger(count) || count < 1 || count > 40) throw new Error("--count is 1 to 40.");

const env = {
  url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey:
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  secretKey: process.env.SUPABASE_SECRET_KEY,
};
assertLoadTarget({ base: command === "run" ? args.base : undefined, supabaseUrl: env.url });
if (!env.publishableKey || !env.secretKey) {
  throw new Error("SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are required.");
}

const { createClient } = require("@supabase/supabase-js");
const noSession = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const service = createClient(env.url, env.secretKey, noSession);
const anon = createClient(env.url, env.publishableKey, noSession);

const people = Array.from({ length: count }, (_, i) => loadPerson(i + 1));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function membersByEmail() {
  const { data, error } = await service
    .from("members")
    .select("id,email,status,role")
    .in(
      "email",
      people.map((p) => p.email),
    );
  if (error) throw new Error(`members read failed: ${error.message}`);
  return new Map(data.map((row) => [row.email, row]));
}

/** Makes the people that are missing (Crew, permanent), reactivates the rest; `--off` deactivates. */
async function preparePeople() {
  const existing = await membersByEmail();
  if (args.off) {
    for (const person of people) {
      const row = existing.get(person.email);
      if (!row || row.status !== "active") continue;
      if (!isLoadEmail(row.email))
        throw new Error(`Refused: ${row.email} is not a rush-test person.`);
      const { error } = await service
        .from("members")
        .update({ status: "deactivated", deactivated_at: isoDaysAgo(0) })
        .eq("id", row.id);
      if (error) throw new Error(`deactivate failed: ${error.message}`);
    }
    process.stdout.write(`Deactivated the rush-test people (kept, never deleted).\n`);
    return;
  }
  const { data: orgs, error: orgError } = await service.from("organizations").select("id").limit(1);
  if (orgError || !orgs?.[0]) throw new Error("no organisation on this project");
  for (const person of people) {
    const row = existing.get(person.email);
    if (row) {
      if (row.role !== "staff") throw new Error(`Refused: ${row.email} is not Crew.`);
      if (row.status !== "active") {
        const { error } = await service
          .from("members")
          .update({ status: "active", deactivated_at: null })
          .eq("id", row.id);
        if (error) throw new Error(`reactivate failed: ${error.message}`);
      }
      continue;
    }
    const userId = await signInUserFor(person.email);
    const { error } = await service.from("members").insert({
      id: userId,
      org_id: orgs[0].id,
      email: person.email,
      full_name: person.fullName,
      role: "staff",
      status: "active",
      // An active member has joined (members_active_has_joined): the day before the run, so the
      // run's own day is an ordinary working day for them (never their joining day).
      joined_at: isoDaysAgo(1),
    });
    if (error) throw new Error(`member insert failed: ${error.message}`);
  }
  process.stdout.write(`${people.length} rush-test people are active.\n`);
}

/** The person's sign-in: made now, or the one a failed earlier run left without a member. */
async function signInUserFor(email) {
  const created = await service.auth.admin.createUser({ email, email_confirm: true });
  if (!created.error) return created.data.user.id;
  if (created.error.code !== "email_exists") {
    throw new Error(`createUser failed: ${created.error.message}`);
  }
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const found = data.users.find((user) => user.email?.toLowerCase() === email);
  if (!found) throw new Error(`no sign-in found for ${email}`);
  return found.id;
}

/** A date `days` before now (an instant; members.joined_at). */
function isoDaysAgo(days) {
  return new Date(performance.timeOrigin + performance.now() - days * 86_400_000).toISOString();
}

/** A session per person, minted slowly (GoTrue allows 30 sign-ins per 5 minutes per address). */
async function mintSessions() {
  const sessions = [];
  for (const [i, person] of people.entries()) {
    if (i > 0) await sleep(Number(args.pace) * 1000);
    const link = await service.auth.admin.generateLink({ type: "magiclink", email: person.email });
    if (link.error) throw new Error(`generateLink failed: ${link.error.message}`);
    const verified = await anon.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: "magiclink",
    });
    if (verified.error) throw new Error(`verifyOtp failed: ${verified.error.message}`);
    sessions.push({
      person,
      session: verified.data.session,
      cookie: await cookieFor(verified.data.session),
    });
    process.stdout.write(`signed in ${i + 1}/${people.length}\n`);
  }
  return sessions;
}

/** The `Cookie` header `@supabase/ssr` makes the browser send (as perf-probe's). */
async function cookieFor(session) {
  const { createServerClient } = require("@supabase/ssr");
  const jar = new Map();
  const client = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new Error(`setSession failed: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

async function timed(run) {
  const started = performance.now();
  try {
    const status = await run();
    return { ms: performance.now() - started, status };
  } catch (error) {
    return { ms: performance.now() - started, status: 0, error: String(error?.message ?? error) };
  }
}

const home = (cookie) =>
  timed(async () => {
    const response = await fetch(`${args.base.replace(/\/+$/, "")}/my-day`, {
      headers: { cookie },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    await response.arrayBuffer();
    // Where a redirect sends the screen (its path only): a sign-in or another screen.
    const location = response.headers.get("location");
    home.redirects.push(
      location ? `${response.status} → ${new URL(location, args.base).pathname}` : null,
    );
    return response.status;
  });
home.redirects = [];

const startDay = (session) =>
  timed(async () => {
    const response = await fetch(`${env.url}/rest/v1/rpc/attendance_start_day`, {
      method: "POST",
      headers: {
        apikey: env.publishableKey,
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (response.ok) {
      try {
        startDay.days.set(session.access_token, JSON.parse(body));
      } catch {
        // Not JSON: no day id from this answer.
      }
    } else {
      // The refusal in the database's own words (`app.fail`: a code and a sentence; no secret).
      startDay.refusals.push(refusalOf(response.status, body));
    }
    return response.status;
  });
startDay.days = new Map();
startDay.refusals = [];

async function onePerson({ session, cookie }, delayMs) {
  await sleep(delayMs);
  const before = await home(cookie);
  const start = await startDay(session);
  start.dayId = startDay.days.get(session.access_token) ?? null;
  const after = await home(cookie);
  return { before, start, after };
}

/**
 * Exactly one day today and one `started` event per person (the database's own count): the IST
 * date as `app.today_ist()` has it is the date the run began on (one run per night, after 22:00).
 */
async function countDays(ids, istDate) {
  const { data: days, error } = await service
    .from("attendance_days")
    .select("id,member_id")
    .in("member_id", ids)
    .eq("work_date", istDate);
  if (error) throw new Error(`attendance_days read failed: ${error.message}`);
  const rows = new Map(ids.map((id) => [id, 0]));
  const started = new Map(ids.map((id) => [id, 0]));
  for (const day of days ?? []) rows.set(day.member_id, (rows.get(day.member_id) ?? 0) + 1);
  const owner = new Map((days ?? []).map((day) => [day.id, day.member_id]));
  if (owner.size) {
    const { data: events, error: eventError } = await service
      .from("attendance_events")
      .select("attendance_day_id,action")
      .in("attendance_day_id", [...owner.keys()])
      .eq("action", "started");
    if (eventError) throw new Error(`attendance_events read failed: ${eventError.message}`);
    for (const event of events ?? []) {
      const member = owner.get(event.attendance_day_id);
      started.set(member, (started.get(member) ?? 0) + 1);
    }
  }
  return { rows, started };
}

/**
 * The business day the Start days landed on, as the database has it (`app.today_ist()`, ADR-0008):
 * the work date of a day a Start day returned. Null when none answered.
 */
async function startedDate(dayIds) {
  if (dayIds.length === 0) return null;
  const { data, error } = await service
    .from("attendance_days")
    .select("work_date")
    .in("id", dayIds)
    .limit(1);
  if (error) throw new Error(`attendance_days read failed: ${error.message}`);
  return data?.[0]?.work_date ?? null;
}

async function run() {
  if (!args.base) throw new Error("--base (staging's address) is required.");
  const members = await membersByEmail();
  const missing = people.filter((p) => members.get(p.email)?.status !== "active");
  if (missing.length)
    throw new Error(`Not active: ${missing.map((p) => p.email).join(", ")}. Run "people" first.`);
  const spreadMs = Number(args.spread) * 1000;
  // One IST day for every Start day (Preview 45674894596 began at 23:59:20 IST, and 13 of 20
  // landed on the next date). Asked before the slow sign-ins and again after them. A local run
  // (`--base` on this machine) is for correctness, at any hour.
  const local = /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(args.base);
  const outsideWindow = () =>
    local ? null : rushWindowRefusal(performance.timeOrigin + performance.now(), spreadMs);
  if (outsideWindow()) throw new Error(outsideWindow());
  const sessions = await mintSessions();
  if (outsideWindow()) throw new Error(outsideWindow());
  process.stdout.write(`T0: ${people.length} Start days over ${args.spread} s\n`);
  const results = await Promise.all(
    sessions.map((entry, i) => onePerson(entry, Math.round((i / people.length) * spreadMs))),
  );
  const ids = people.map((p) => members.get(p.email).id);
  const istDate = await startedDate(results.map((r) => r.start.dayId).filter(Boolean));
  if (istDate === null) throw new Error("No Start day answered with a day: nothing to count.");
  const { rows, started } = await countDays(ids, istDate);
  const perPerson = results.map((result, i) => ({
    ok: result.start.status >= 200 && result.start.status < 300 && result.after.status === 200,
    status: result.start.status,
    waitMs: result.start.ms + result.after.ms,
    rows: rows.get(ids[i]) ?? 0,
    started: started.get(ids[i]) ?? 0,
  }));
  const outcome = verdict(perPerson);
  const steps = {
    "home before": stepSummary(results.map((r) => r.before.ms)),
    "Start day": stepSummary(results.map((r) => r.start.ms)),
    "home after": stepSummary(results.map((r) => r.after.ms)),
    "wait (Start day + home)": outcome.wait,
  };
  const errors = results
    .flatMap((r) => [r.before, r.start, r.after])
    .filter((s) => s.status === 0 || s.status >= 500);
  const lines = [
    ...reportLines(outcome, steps),
    `5xx or no answer: ${errors.length}`,
    // What each step answered, so a refusal is named in the job's log (Preview 45674894596: 13
    // people failed with no 5xx, and the reason sat only in the kept JSON).
    `Start day answers: ${tally(results.map((r) => r.start.status))}`,
    `Start day refusals: ${tally(startDay.refusals) || "none"}`,
    `home after answers: ${tally(results.map((r) => r.after.status))}`,
    `home redirects: ${tally(home.redirects.filter(Boolean)) || "none"}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
  if (args.out)
    writeFileSync(
      args.out,
      JSON.stringify(
        {
          outcome,
          steps,
          perPerson,
          errors,
          refusals: startDay.refusals,
          redirects: home.redirects,
        },
        null,
        2,
      ),
    );
  if (!outcome.pass) process.exitCode = 1;
}

if (command === "people") await preparePeople();
else if (command === "run") await run();
else throw new Error("Usage: load-10am.mjs people|run … (see the header).");
