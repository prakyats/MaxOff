import { request as httpRequest } from "node:http";

import { expect, type Locator, type Page } from "@playwright/test";

import { HOLD_PROXY_URL } from "./hold-proxy-config";

/** The local sign-ins created by `supabase/seed.sql` (README → "Local sign-ins"). */
export const USERS = {
  owner: { email: "owner@maxoff.local", password: "owner-local-password", home: "/today" },
  admin: { email: "admin@maxoff.local", password: "admin-local-password", home: "/today" },
  staff: { email: "staff@maxoff.local", password: "staff-local-password", home: "/my-day" },
  deactivated: { email: "gone@maxoff.local", password: "gone-local-password", home: null },
  /** Only the recovery flow uses this one: it changes the password and puts it back by id. */
  reset: {
    email: "reset@maxoff.local",
    password: "reset-local-password",
    home: "/my-day",
    id: "10000000-0000-4000-8000-000000000005",
  },
  /** Only the team flow uses this one, since that test deactivates them (1.3). */
  leaver: { email: "leaver@maxoff.local", password: "leaver-local-password", home: "/my-day" },
} as const;

export type SessionRole = "owner" | "admin" | "staff";

export function storageStateFor(role: SessionRole): string {
  return `e2e/.auth/${role}.json`;
}

/**
 * Fills the real sign-in form. Resolves once the browser has left /login and, for an Admin or
 * Staff member whose day has not started, once the Start-day prompt (3b.1) has been answered
 * with **Start day**, so a flow spec lands on a started day as it landed past the gate before.
 * `e2e/working-day.spec.ts` passes `{ day: "stop" }` to meet the prompt itself.
 */
export async function signIn(
  page: Page,
  email: string,
  password: string,
  { day = "start" }: { day?: "start" | "stop" } = {},
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The form shows any refusal. No allowance for a cold server: every route is warmed by the
  // `setup` project before a flow spec runs (`warm.setup.ts`, 2.6).
  await expect(page).not.toHaveURL(/\/login/);
  if (day === "start") await answerStartPrompt(page);
}

/**
 * The screen's title bar, **the visible one**. A route's `loading.tsx` draws the same header
 * so nothing moves when the data lands (ARCHITECTURE §14.1), and React streams the resolved
 * page into the DOM *hidden* (`<div hidden id="S:…">`) before its `$RC` script swaps it in, so
 * for a few milliseconds both headers exist. A strict locator on the slot then throws at once
 * (strictness is not retried) — seen in the 2.6 proof on /people at 375px. Always go through
 * here, never `locator('[data-slot="page-header"]')` alone.
 */
export function pageHeader(page: Page): Locator {
  return page.locator('[data-slot="page-header"]:visible');
}

/** The Start-day prompt (3b.1): a bottom sheet on a phone, a dialog on desktop. */
export function startPrompt(page: Page): Locator {
  return page.locator('[data-slot="start-day-prompt"]');
}

/**
 * Starts the day from the prompt when the layout mounted it; otherwise nothing. Waits for what
 * is rendered, not for the URL: after a sign-in the browser passes through `/set-password`, `/`
 * and the home route before the layout renders, so any URL check can run too early. The screen's
 * title bar ends the wait; the layout's hidden marker says whether the prompt is there at all,
 * and the prompt itself opens once hydrated. After Start day the tree re-renders without it.
 */
export async function answerStartPrompt(page: Page): Promise<void> {
  await expect(pageHeader(page)).toBeVisible();
  const mounted = page.locator('[data-slot="start-day-prompt-mount"]');
  if ((await mounted.count()) === 0) return;
  const prompt = startPrompt(page);
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Start day" }).click();
  await expect(prompt).toBeHidden();
  await expect(mounted).toHaveCount(0);
}

/**
 * Calls a database function as that person, the way the app's server does (GoTrue password
 * grant, then PostgREST). For arranging state a spec is not about, e.g. an approved leave.
 */
export async function rpcAs<T = unknown>(
  email: string,
  password: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { ok, text } = await rpcCall(email, password, fn, args);
  expect(ok, `${fn} as ${email}: ${text}`).toBe(true);
  // A function that returns void answers with an empty body (204).
  return (text ? JSON.parse(text) : null) as T;
}

/**
 * The same call where the database must refuse (4B review S10): resolves with the error's body,
 * whose `message` is the code (`FORBIDDEN`, `VALIDATION`, …) and `details` the sentence.
 */
export async function rpcRefusedAs(
  email: string,
  password: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ message: string; details: string | null }> {
  const { ok, text } = await rpcCall(email, password, fn, args);
  expect(ok, `${fn} as ${email} is refused: ${text}`).toBe(false);
  return JSON.parse(text) as { message: string; details: string | null };
}

async function rpcCall(
  email: string,
  password: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const { url, apikey } = supabaseAuth();
  const accessToken = await accessTokenFor(email, password);
  const rest = url.replace(/\/auth\/v1$/, "/rest/v1");
  const response = await fetch(`${rest}/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return { ok: response.ok, text: await response.text() };
}

/** A real session's access token for a seeded person, from GoTrue's password grant. */
async function accessTokenFor(email: string, password: string): Promise<string> {
  const { url, apikey } = supabaseAuth();
  const token = await fetch(`${url}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(token.ok, `sign-in for ${email}`).toBe(true);
  const { access_token: accessToken } = (await token.json()) as { access_token: string };
  return accessToken;
}

/**
 * A plain edit through PostgREST as that person, so RLS and the guards apply as in the app:
 * "someone else changed it" without a second browser.
 */
export async function patchAs(
  email: string,
  password: string,
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { url, apikey } = supabaseAuth();
  const accessToken = await accessTokenFor(email, password);
  const rest = url.replace(/\/auth\/v1$/, "/rest/v1");
  const response = await fetch(`${rest}/${path}`, {
    method: "PATCH",
    headers: {
      apikey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  const body: unknown = await response.json();
  expect(response.ok, `PATCH ${path} as ${email}: ${JSON.stringify(body)}`).toBe(true);
  expect(body, `PATCH ${path} as ${email} changed a row`).not.toEqual([]);
}

/**
 * A plain insert through PostgREST as that person (RLS and the guards apply as in the app), for a
 * fixture only the person may write: a task template is written by its author (4C mechanics (6)).
 * Resolves with the row.
 */
export async function insertAs<T>(
  email: string,
  password: string,
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const { url, apikey } = supabaseAuth();
  const accessToken = await accessTokenFor(email, password);
  const rest = url.replace(/\/auth\/v1$/, "/rest/v1");
  const response = await fetch(`${rest}/${table}`, {
    method: "POST",
    headers: {
      apikey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  const body: unknown = await response.json();
  expect(response.ok, `POST ${table} as ${email}: ${JSON.stringify(body)}`).toBe(true);
  return (body as T[])[0] as T;
}

/**
 * PostgREST as the service role, **for the local test database only**: it bypasses RLS and the
 * transition functions, so it refuses any URL that is not this machine's stack. For clearing a
 * spec's own fixture person and for reading ids a spec needs, never for the flow under test.
 */
async function serviceRest(path: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  expect(new URL(url).hostname, "service-role cleanup runs on the local stack only").toMatch(
    /^(127\.0\.0\.1|localhost)$/,
  );
  expect(key, "SUPABASE_SECRET_KEY is set (playwright.config loads .env.local)").toBeTruthy();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      // A legacy service_role JWT also needs the bearer header; an sb_secret key does not.
      ...(key.startsWith("eyJ") ? { authorization: `Bearer ${key}` } : {}),
      "content-type": "application/json",
      ...init.headers,
    },
  });
  expect(response.ok, `${init.method ?? "GET"} ${path}: ${response.status}`).toBe(true);
  return response;
}

/**
 * GoTrue's admin API as the service role, local stack only (same guard as `serviceRest`): for a
 * spec that needs a recovery link without Mailpit, or to put a fixture's password back.
 */
async function serviceAuth(path: string, init: RequestInit): Promise<unknown> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  expect(new URL(url).hostname, "service-role auth calls run on the local stack only").toMatch(
    /^(127\.0\.0\.1|localhost)$/,
  );
  const response = await fetch(`${url}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body: unknown = await response.json();
  expect(response.ok, `${init.method ?? "GET"} admin/${path}: ${JSON.stringify(body)}`).toBe(true);
  return body;
}

/** A fresh one-time recovery link for `email`, as `/auth/confirm` expects it (path + query). */
export async function recoveryLinkFor(email: string): Promise<string> {
  const body = (await serviceAuth("generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "recovery", email }),
  })) as { hashed_token?: string; properties?: { hashed_token?: string } };
  const token = body.hashed_token ?? body.properties?.hashed_token;
  expect(token, "generate_link returned a hashed token").toBeTruthy();
  return `/auth/confirm?token_hash=${token as string}&type=recovery`;
}

/** Puts a fixture person's password back after a spec changed it. */
export async function setPasswordFor(userId: string, password: string): Promise<void> {
  await serviceAuth(`users/${userId}`, { method: "PUT", body: JSON.stringify({ password }) });
}

/**
 * Inserts one row through `serviceRest`, for a state no flow can reach any more (e.g. a request
 * that clashes with leave approved since, 2.4). Returns the row.
 */
export async function serviceInsert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const response = await serviceRest(table, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const body = (await response.json()) as T[];
  expect(response.ok, `insert into ${table}: ${JSON.stringify(body)}`).toBe(true);
  return body[0] as T;
}

/** Updates the rows a PostgREST filter names through `serviceRest` (a fixture's own rows only). */
export async function serviceUpdate(path: string, patch: Record<string, unknown>): Promise<void> {
  const response = await serviceRest(path, { method: "PATCH", body: JSON.stringify(patch) });
  expect(response.ok, `update ${path}: ${await response.text()}`).toBe(true);
}

/** Deletes rows through `serviceRest` (a PostgREST filter, e.g. `extra_work_notes?member_id=eq.…`). */
export async function serviceDelete(path: string): Promise<void> {
  const response = await serviceRest(path, { method: "DELETE" });
  expect(response.ok, `delete ${path}: ${await response.text()}`).toBe(true);
}

/** Reads rows through `serviceRest` (a PostgREST query string, e.g. `leave_requests?id=eq.…`). */
export async function serviceSelect<T>(path: string): Promise<T[]> {
  return (await (await serviceRest(path)).json()) as T[];
}

/**
 * Deletes one fixture person's attendance days, their events, every leave request and, since
 * 3b.2, their extra work notes and comp leave credits, so a spec that owns that person can run
 * again without `pnpm db:reset` (2.3). The audit trigger still logs the deletes; nothing else
 * refers to these rows.
 */
/** Removes a member's expense claims (3b.3), so a spec re-runs on a used database. */
export async function resetExpenseClaims(memberId: string): Promise<void> {
  await serviceRest(`expense_claims?member_id=eq.${memberId}`, { method: "DELETE" });
}

export async function resetAttendanceAndLeave(memberId: string): Promise<void> {
  // 3b.2: comp leave credits point at leave requests (through their uses) and at notes.
  const credits = await serviceSelect<{ id: string }>(
    `comp_leave_credits?member_id=eq.${memberId}&select=id`,
  );
  if (credits.length > 0) {
    const ids = credits.map((credit) => credit.id).join(",");
    await serviceRest(`comp_leave_credit_uses?credit_id=in.(${ids})`, { method: "DELETE" });
  }
  await serviceRest(`comp_leave_credits?member_id=eq.${memberId}`, { method: "DELETE" });
  await serviceRest(`extra_work_notes?member_id=eq.${memberId}`, { method: "DELETE" });
  const days = await serviceSelect<{ id: string }>(
    `attendance_days?member_id=eq.${memberId}&select=id`,
  );
  if (days.length > 0) {
    const ids = days.map((day) => day.id).join(",");
    await serviceRest(`attendance_events?attendance_day_id=in.(${ids})`, { method: "DELETE" });
  }
  await serviceRest(`attendance_days?member_id=eq.${memberId}`, { method: "DELETE" });
  // One statement: a change's `supersedes_id` points at its original, and Postgres checks
  // the foreign key at the end of the statement.
  await serviceRest(`leave_requests?member_id=eq.${memberId}`, { method: "DELETE" });
}

/**
 * Removes a person a spec creates (an invitee), member row and GoTrue sign-in included, so the
 * spec can invite them again on a database that is not fresh (2.6: five runs after one
 * `db:reset`). Every row that points at the member goes first; the audit rows *about* them
 * (`entity_id`, no foreign key) stay, as history should. A sign-in left behind by an invite
 * that never became a member is removed too. Nothing to remove is fine.
 */
export async function removeFixturePerson(email: string): Promise<void> {
  const members = await serviceSelect<{ id: string }>(
    `members?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id`,
  );
  for (const { id } of members) {
    await resetAttendanceAndLeave(id);
    await resetExpenseClaims(id);
    await serviceRest(`session_events?member_id=eq.${id}`, { method: "DELETE" });
    await serviceRest(`activity_log?actor_id=eq.${id}`, { method: "DELETE" });
    // 4C: a freelancer invited as an employee keeps their coordinator history (ADR-0013).
    await serviceRest(`member_coordinators?or=(member_id.eq.${id},coordinator_id.eq.${id})`, {
      method: "DELETE",
    });
    await serviceRest(`members?id=eq.${id}`, { method: "DELETE" });
  }
  const listed = (await serviceAuth(
    `users?page=1&per_page=50&filter=${encodeURIComponent(email)}`,
    {
      method: "GET",
    },
  )) as { users?: Array<{ id: string; email?: string }> };
  for (const user of listed.users ?? []) {
    if (user.email?.toLowerCase() !== email.toLowerCase()) continue;
    await serviceAuth(`users/${user.id}`, { method: "DELETE" });
  }
}

/**
 * Removes job titles a spec adds (archived or not), so the seeded list is what it expects on
 * a database that is not fresh (2.6). A member still holding one of them is not expected.
 */
export async function removeJobTitles(names: string[]): Promise<void> {
  const list = names.map((name) => `"${name}"`).join(",");
  await serviceRest(`list_items?list_key=eq.job_title&name=in.(${encodeURIComponent(list)})`, {
    method: "DELETE",
  });
}

/**
 * `resetAttendanceAndLeave()` for a seeded person known by email (the working-day people), so a
 * spec that must meet the Start-day prompt meets it on every run, not only after `db:reset`.
 */
export async function resetAttendanceAndLeaveOf(email: string): Promise<void> {
  const [member] = await serviceSelect<{ id: string }>(
    `members?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id`,
  );
  expect(member, `${email} is seeded`).toBeTruthy();
  await resetAttendanceAndLeave((member as { id: string }).id);
}

/** The local stack's Mailpit (config.toml `[local_smtp]`, port 54324). */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSearch = { messages: Array<{ ID: string; Created: string }> };
type MailpitMessage = { HTML: string; Text: string };

/**
 * The first email to `to` that Mailpit received **after** `since`, polling for a few seconds.
 * Take `since` before the request that sends it. Mailpit is shared by every worker and survives
 * `db:reset`, so "the newest message" could be one from an earlier run or another worker whose
 * link was already spent; the lower bound is what makes the answer this test's own (2.6).
 * Nothing clears the mailbox any more: one worker wiping it was itself the hazard for the rest.
 */
export async function latestEmailTo(to: string, since: Date): Promise<MailpitMessage> {
  const query = encodeURIComponent(`to:${to}`);
  // Mailpit stamps `Created` with the Docker VM's clock, which can sit a little behind the
  // host's; two seconds of slack covers that and admits nothing an earlier test could have sent.
  const bound = since.getTime() - 2_000;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=5`);
    const { messages } = (await search.json()) as MailpitSearch;
    const fresh = messages.find((message) => new Date(message.Created).getTime() >= bound);
    if (fresh) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${fresh.ID}`);
      return (await message.json()) as MailpitMessage;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `No email to ${to} newer than ${since.toISOString()} reached Mailpit at ${MAILPIT_URL}`,
  );
}

/**
 * The `/auth/confirm` link inside an auth email, re-pointed at the server under test. GoTrue
 * builds the link from config.toml `site_url` (port 3000) while Playwright serves the app on
 * its own port, so only the path and query are kept: a link that only opens because a stray
 * dev server happens to listen on 3000 would hide exactly the failure CI sees. A spec opens the
 * link with `followAuthLink()`.
 */
export function confirmLinkFrom(email: MailpitMessage, baseURL: string | undefined): string {
  const href = email.HTML.match(/href="([^"]*\/auth\/confirm[^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
  expect(href, "the email links to /auth/confirm").toBeTruthy();
  return onBaseURL(href as string, baseURL);
}

/**
 * An `/auth/confirm` link re-pointed at the server under test, keeping its path and query.
 * The app builds invite links on `NEXT_PUBLIC_APP_URL` (port 3000 in `.env.local`) and GoTrue
 * builds recovery links on `site_url`; the suite runs on its own port.
 */
export function onBaseURL(href: string, baseURL: string | undefined): string {
  expect(baseURL, "Playwright's baseURL is set").toBeTruthy();
  const link = new URL(href);
  expect(link.pathname).toBe("/auth/confirm");
  expect(link.searchParams.get("token_hash"), "the token hash survives").toBeTruthy();
  return new URL(`${link.pathname}${link.search}`, baseURL).toString();
}

/** The one button on the Continue page (3cB review). */
export const CONTINUE_BUTTON = "Continue to MaxOff";

/**
 * Opens an `/auth/confirm` link the way a person does (3cB review; ROADMAP 5.2's prerequisite):
 * the Continue page, then **Continue to MaxOff**. The page's GET spends nothing, so a chat
 * preview or a mail scanner fetching the link first changes nothing; the POST behind the button
 * verifies the one-time token and lands on /set-password, or on /login with the reason when the
 * link is spent, expired or not an active member's. `e2e/auth-link.spec.ts` proves each of those.
 */
export async function followAuthLink(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await page.getByRole("button", { name: CONTINUE_BUTTON }).click();
  await expect(page).not.toHaveURL(/\/auth\/confirm/);
}

/**
 * The Supabase refresh token inside a browser context's auth cookie. `@supabase/ssr` stores the
 * session as `base64-<base64url JSON>` in `sb-<ref>-auth-token`, split into `.0`, `.1`, … chunks
 * when long. Reading it lets a test prove that a deactivated person's token is refused by GoTrue.
 */
export function refreshTokenFrom(cookies: ReadonlyArray<{ name: string; value: string }>): string {
  const chunks = cookies
    .filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  expect(chunks.length, "an auth cookie is present").toBeGreaterThan(0);
  const raw = chunks.map((cookie) => cookie.value).join("");
  const encoded = raw.startsWith("base64-") ? raw.slice("base64-".length) : raw;
  const json = raw.startsWith("base64-")
    ? Buffer.from(encoded, "base64url").toString("utf8")
    : decodeURIComponent(encoded);
  const session = JSON.parse(json) as { refresh_token?: string };
  expect(session.refresh_token, "the cookie holds a refresh token").toBeTruthy();
  return session.refresh_token as string;
}

/** The local GoTrue, for calls the app itself never makes. */
export function supabaseAuth(): { url: string; apikey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  expect(url, "NEXT_PUBLIC_SUPABASE_URL is set (playwright.config loads .env.local)").toBeTruthy();
  expect(apikey, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set").toBeTruthy();
  return { url: `${url as string}/auth/v1`, apikey: apikey as string };
}

/**
 * Makes the page look installed, which is how `tab-history` decides which rule to apply.
 *
 * Chromium cannot actually emulate `display-mode: standalone` in a normal page: both
 * `page.emulateMedia` and CDP `Emulation.setEmulatedMedia` with a `display-mode` feature leave
 * `matchMedia("(display-mode: standalone)").matches` false (checked against this Chromium
 * build). Only a genuinely installed window reports it. So the media query itself is stubbed
 * before the page loads — the platform signal is faked, and what gets tested is our logic on top
 * of it, which is the part that can actually be wrong.
 */
export async function runInstalled(page: Page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes("display-mode: standalone")
        ? ({
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => false,
          } as unknown as MediaQueryList)
        : real(query);
  });
}

/**
 * The app has hydrated: `MobileChrome` sets `data-chrome` on `<html>` when it mounts, at every
 * width. Before that the pre-hydration script answers back, view and tab taps with the same moves
 * (2.8), but without the slide and without the app's listeners, so a spec that checks client
 * behaviour (a typed transition, a scroll restore, refresh on return) waits for this after
 * `goto`. Not the root layout: it hydrates before the streamed shell (2.8, found by CI).
 */
export async function hydrated(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-chrome", /.+/);
}

/** One back press: what it must close (if anything), and where the page must be afterwards. */
export type BackStep = { closes?: Locator; url: RegExp };

/**
 * A screen's back order as one readable assertion (ARCHITECTURE §14.2): presses back once per
 * step, and after each checks that the named layer closed and the URL is where it should be. A
 * view control that pushed history, or an overlay that failed to register, shows up as the
 * wrong URL on the step it broke.
 */
export async function expectBackStack(page: Page, steps: readonly BackStep[]): Promise<void> {
  for (const [index, step] of steps.entries()) {
    await page.goBack();
    if (step.closes) await expect(step.closes, `back #${index + 1} closes its layer`).toBeHidden();
    await expect(page, `back #${index + 1} lands`).toHaveURL(step.url);
  }
}

/**
 * Removes custom field definitions a spec adds, by key (3.2), so it re-runs on a database an
 * earlier run used. The audit rows about them stay, as history should.
 */
export async function removeFieldDefinitions(keys: string[]): Promise<void> {
  const list = keys.map((key) => `"${key}"`).join(",");
  await serviceRest(`field_definitions?key=in.(${encodeURIComponent(list)})`, {
    method: "DELETE",
  });
}

/**
 * Removes a client a spec creates (3.1), with the rows the triggers made for it and every
 * definition scoped to it. Nothing to remove is fine.
 */
export async function removeClientFixture(name: string): Promise<void> {
  const clients = await serviceSelect<{ id: string }>(
    `clients?name=eq.${encodeURIComponent(name)}&select=id`,
  );
  for (const { id } of clients) {
    await serviceRest(`field_definitions?client_id=eq.${id}`, { method: "DELETE" });
    await serviceRest(`client_contacts?client_id=eq.${id}`, { method: "DELETE" });
    await serviceRest(`client_admin_assignments?client_id=eq.${id}`, { method: "DELETE" });
    await serviceRest(`client_brand?client_id=eq.${id}`, { method: "DELETE" });
    await serviceRest(`client_private?client_id=eq.${id}`, { method: "DELETE" });
    await serviceRest(`clients?id=eq.${id}`, { method: "DELETE" });
  }
}

/** The seeded member's id for an email, through the service role (fixtures only). */
export async function memberIdOf(email: string): Promise<string> {
  const rows = await serviceSelect<{ id: string }>(
    `members?email=eq.${encodeURIComponent(email)}&select=id`,
  );
  const id = rows[0]?.id;
  expect(id, `a member with ${email}`).toBeTruthy();
  return id as string;
}

/**
 * Every finite animation and transition on the page has finished (looping ones, a spinner or a
 * skeleton's pulse, never do and are ignored). Measure layout after this: a control that was just
 * tapped eases back from its pressed scale (`pressable`, 120 ms), and a sheet slides in, so a box
 * read during either is a few pixels off what the person sees a moment later.
 */
export async function animationsSettled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const iterations = animation.effect?.getComputedTiming().iterations;
      return iterations === Infinity || animation.playState !== "running";
    }),
  );
}

/** Fails if the page can be scrolled sideways at all: no clipped columns, no wide table. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    // Whatever is actually sticking out, so a failure names the culprit.
    wide: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ""}`),
  }));
  expect(overflow.wide, "nothing reaches past the right edge").toEqual([]);
  expect(overflow.scrollWidth, "the page does not scroll sideways").toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

/**
 * The screen has streamed in: its title bar is up and no skeleton is left. `page.goto` resolves
 * on `load`, and that is not the end of a streamed page: React 19.2 reveals a server-rendered
 * Suspense boundary in batches (`$RC` schedules the swap up to 300 ms after the previous reveal),
 * so a route's `loading.tsx` can still be on screen for a moment after `goto` returns (CI,
 * 2026-09-29: the Owner's /me measured its skeleton at 200%). The loading screens have their own
 * check (`e2e/loading-screens.spec.ts`), where the skeleton is held on screen on purpose.
 */
export async function expectSettled(page: Page): Promise<void> {
  await expect(pageHeader(page)).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
}

/**
 * Signs this page's browser context in as `email` with a session of its own (GoTrue's password
 * grant, stored in the cookie as `@supabase/ssr` stores it, over the saved storage state's), and
 * returns that session's id (the access token's `session_id`). A hold on the e2e server's
 * Supabase proxy keyed by it (`holdReads`) catches this test's page and nobody else's: every
 * other test of the same person runs on the saved sessions and is never held.
 */
export async function ownSession(page: Page, email: string, password: string): Promise<string> {
  const { url, apikey } = supabaseAuth();
  const answer = await fetch(`${url}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(answer.ok, `sign-in for ${email}`).toBe(true);
  const session = (await answer.json()) as { access_token: string };
  const claims = JSON.parse(
    Buffer.from(session.access_token.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { session_id?: string };
  expect(claims.session_id, "the access token names its session").toBeTruthy();

  const context = page.context();
  const saved = (await context.cookies()).filter((cookie) =>
    /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name),
  );
  const base = saved[0];
  if (!base) throw new Error("the saved storage state holds no session cookie");
  const name = base.name.replace(/\.\d+$/, "");
  // `@supabase/ssr`: "base64-" + base64url(JSON), split into `.0`, `.1`, … past 3180 characters.
  const value = `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64url")}`;
  const size = 3180;
  const chunks =
    value.length <= size
      ? [{ name, value }]
      : Array.from({ length: Math.ceil(value.length / size) }, (_, index) => ({
          name: `${name}.${index}`,
          value: value.slice(index * size, (index + 1) * size),
        }));
  await context.clearCookies({ name: /^sb-.*-auth-token(\.\d+)?$/ });
  await context.addCookies(
    chunks.map((chunk) => ({
      ...chunk,
      domain: base.domain,
      path: base.path,
      expires: base.expires,
      httpOnly: base.httpOnly,
      secure: base.secure,
      sameSite: base.sameSite,
    })),
  );
  return claims.session_id as string;
}

/**
 * Holds one browser session's reads of one PostgREST path (`/rest/v1/task_types`,
 * `/rest/v1/rpc/…`) at the e2e server's Supabase proxy (`e2e/hold-proxy.ts`, 4C review M1) until
 * `release()`: the page that needs them cannot answer, so React streams its loading screen and
 * keeps it up, on the path a phone takes on a cold open, for as long as a check needs, and never
 * races the page. Hold a read only the **page** makes (never one the `(app)` layout awaits, or no
 * shell streams), for a session of the test's own (`ownSession`), so no other test is held.
 * `caught()` says whether the proxy has held one of those requests yet (the page's read reached
 * it). Release it in `finally`: a hold is the open connection, so a test that dies releases it
 * too.
 */
export async function holdReads(
  path: string,
  session: string,
): Promise<{ caught: () => boolean; release: () => void }> {
  let caught = false;
  const request = httpRequest(`${HOLD_PROXY_URL}/__hold`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  await new Promise<void>((resolve, reject) => {
    request.on("error", reject);
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`hold-proxy refused the hold of ${path}: ${response.statusCode}`));
        return;
      }
      let buffered = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const event = JSON.parse(line) as { hold?: number; caught?: string };
          if (event.hold !== undefined) resolve();
          if (event.caught !== undefined) caught = true;
        }
      });
    });
    request.end(JSON.stringify({ path, session }));
  });
  return {
    caught: () => caught,
    release: () => {
      request.destroy();
    },
  };
}

/**
 * Removes the tasks a spec made (4B), by title prefix, with every child row, so the spec re-runs
 * on a used database. The audit rows about them stay (history; no foreign key). Service role,
 * local stack only: `tasks` has no API delete at all.
 */
export async function removeTasksTitled(prefix: string): Promise<void> {
  const tasks = await serviceSelect<{ id: string }>(
    `tasks?title=like.${encodeURIComponent(`${prefix}*`)}&select=id`,
  );
  if (tasks.length === 0) return;
  const ids = tasks.map((task) => task.id).join(",");
  // 4.6: a request converted into one of them points at it.
  await serviceRest(`task_requests?task_id=in.(${ids})`, { method: "DELETE" });
  for (const table of [
    "task_warnings",
    "task_reviews",
    "task_submissions",
    "task_comments",
    "task_stages",
    "task_assignees",
  ]) {
    await serviceRest(`${table}?task_id=in.(${ids})`, { method: "DELETE" });
  }
  await serviceRest(`tasks?id=in.(${ids})`, { method: "DELETE" });
}

/** A task type's id by its seeded name ("Normal", "Shoot / Site Visit", …). */
export async function taskTypeId(name: string): Promise<string> {
  const [row] = await serviceSelect<{ id: string }>(
    `task_types?name=eq.${encodeURIComponent(name)}&select=id`,
  );
  expect(row, `the task type ${name} is seeded`).toBeTruthy();
  return (row as { id: string }).id;
}

/**
 * Removes the task requests a spec suggested (4.6), by title prefix, whatever their state. A task
 * one became is the spec's own to remove (`removeTasksTitled`).
 */
export async function removeRequestsTitled(prefix: string): Promise<void> {
  await serviceRest(`task_requests?title=like.${encodeURIComponent(`${prefix}*`)}`, {
    method: "DELETE",
  });
}

/**
 * Removes the task templates a spec made (4.6), by name prefix; a task started from one forgets
 * it first (`tasks.template_id`). Service role, local stack only: templates are never deleted in
 * the app.
 */
export async function removeTemplatesNamed(prefix: string): Promise<void> {
  const templates = await serviceSelect<{ id: string }>(
    `task_templates?name=like.${encodeURIComponent(`${prefix}*`)}&select=id`,
  );
  if (templates.length === 0) return;
  const ids = templates.map((template) => template.id).join(",");
  await serviceUpdate(`tasks?template_id=in.(${ids})`, { template_id: null });
  await serviceRest(`task_templates?id=in.(${ids})`, { method: "DELETE" });
}

/**
 * Removes the task types a spec added (4C: archived, never deleted, in the app), with the task
 * fields and templates scoped to them. The spec removes its tasks first (`removeTasksTitled`).
 */
export async function removeTaskTypesNamed(prefix: string): Promise<void> {
  const types = await serviceSelect<{ id: string }>(
    `task_types?name=like.${encodeURIComponent(`${prefix}*`)}&select=id`,
  );
  if (types.length === 0) return;
  const ids = types.map((type) => type.id).join(",");
  await serviceRest(`task_templates?task_type_id=in.(${ids})`, { method: "DELETE" });
  await serviceRest(`field_definitions?task_type_id=in.(${ids})`, { method: "DELETE" });
  await serviceRest(`task_types?id=in.(${ids})`, { method: "DELETE" });
}

/**
 * Removes the freelancers a spec added (4C, ADR-0013: no email, so by name prefix), their
 * coordinator rows and any task row naming them first. A freelancer who was invited as an
 * employee has an email by then: `removeFixturePerson` removes them.
 */
export async function removeFreelancersNamed(prefix: string): Promise<void> {
  const members = await serviceSelect<{ id: string }>(
    `members?engagement=eq.freelance&full_name=like.${encodeURIComponent(`${prefix}*`)}&select=id`,
  );
  for (const { id } of members) {
    await serviceRest(`task_assignees?member_id=eq.${id}`, { method: "DELETE" });
    await serviceRest(`member_coordinators?member_id=eq.${id}`, { method: "DELETE" });
    await serviceRest(`members?id=eq.${id}`, { method: "DELETE" });
  }
}
