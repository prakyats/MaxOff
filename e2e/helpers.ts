import { expect, type Locator, type Page } from "@playwright/test";

/** The local sign-ins created by `supabase/seed.sql` (README → "Local sign-ins"). */
export const USERS = {
  owner: { email: "owner@maxoff.local", password: "owner-local-password", home: "/today" },
  admin: { email: "admin@maxoff.local", password: "admin-local-password", home: "/today" },
  staff: { email: "staff@maxoff.local", password: "staff-local-password", home: "/my-day" },
  deactivated: { email: "gone@maxoff.local", password: "gone-local-password", home: null },
  /** Only the recovery flow uses this one, since that test changes its password. */
  reset: { email: "reset@maxoff.local", password: "reset-local-password", home: "/my-day" },
  /** Only the team flow uses this one, since that test deactivates them (1.3). */
  leaver: { email: "leaver@maxoff.local", password: "leaver-local-password", home: "/my-day" },
} as const;

export type SessionRole = "owner" | "admin" | "staff";

export function storageStateFor(role: SessionRole): string {
  return `e2e/.auth/${role}.json`;
}

/**
 * Fills the real sign-in form. Resolves once the browser has left /login and, for an Admin or
 * Staff member whose day still needs a choice, once the day gate (2.2) has been answered with
 * Present, so a flow spec lands where it did before the gate existed. `e2e/day-gate.spec.ts`
 * passes `{ gate: "stop" }` to meet the gate itself.
 */
export async function signIn(
  page: Page,
  email: string,
  password: string,
  { gate = "present" }: { gate?: "present" | "stop" } = {},
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The first server action after boot can take a while; the form shows any refusal.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
  if (gate === "present") await passGate(page);
}

/** The four answers of the gate, as the choice screen labels them. */
export type GateChoice = "Present" | "Leave" | "Half day" | "Comp leave";

/** Answers the gate on `/attendance` and waits until the browser has left it. */
export async function chooseAttendance(
  page: Page,
  choice: GateChoice,
  reason?: string,
): Promise<void> {
  await expect(page).toHaveURL(/\/attendance/);
  // The radio's name is the label plus its hint ("Leave The whole day off."): anchor it, so
  // "Leave" never matches "Comp leave".
  await page.getByRole("radio", { name: new RegExp(`^${choice}\\b`) }).check();
  if (reason) await page.getByLabel("Reason (optional)").fill(reason);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page).not.toHaveURL(/\/attendance/, { timeout: 15_000 });
}

/**
 * Present at the gate when the browser ends up on it; otherwise nothing. Waits for what is
 * rendered, not for the URL: after a sign-in the browser passes through `/set-password`, `/`
 * and the home route before the layout may send it on to the gate, so any URL check can run
 * too early. Either the gate's options or a shell screen's title bar ends the wait.
 */
export async function passGate(page: Page): Promise<void> {
  const gate = page.locator('[data-slot="choice-option"]').first();
  const screen = page.locator('[data-slot="page-header"]').first();
  await expect(gate.or(screen)).toBeVisible({ timeout: 15_000 });
  if (await gate.isVisible()) await chooseAttendance(page, "Present");
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
  const { url, apikey } = supabaseAuth();
  const token = await fetch(`${url}/token?grant_type=password`, {
    method: "POST",
    headers: { apikey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(token.ok, `sign-in for ${email}`).toBe(true);
  const { access_token: accessToken } = (await token.json()) as { access_token: string };
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
  const body: unknown = await response.json();
  expect(response.ok, `${fn} as ${email}: ${JSON.stringify(body)}`).toBe(true);
  return body as T;
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

/** Reads rows through `serviceRest` (a PostgREST query string, e.g. `leave_requests?id=eq.…`). */
export async function serviceSelect<T>(path: string): Promise<T[]> {
  return (await (await serviceRest(path)).json()) as T[];
}

/**
 * Deletes one fixture person's attendance days, their events and every leave request, so a
 * spec that owns that person can run again without `pnpm db:reset` (2.3). The audit trigger
 * still logs the deletes; nothing else refers to these rows.
 */
export async function resetAttendanceAndLeave(memberId: string): Promise<void> {
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

/** The local stack's Mailpit (config.toml `[local_smtp]`, port 54324). */
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type MailpitSearch = { messages: Array<{ ID: string }> };
type MailpitMessage = { HTML: string; Text: string };

/** The newest email sent to `to`, polling for a few seconds. */
export async function latestEmailTo(to: string): Promise<MailpitMessage> {
  const query = encodeURIComponent(`to:${to}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=1`);
    const { messages } = (await search.json()) as MailpitSearch;
    const id = messages[0]?.ID;
    if (id) {
      const message = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
      return (await message.json()) as MailpitMessage;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email to ${to} reached Mailpit at ${MAILPIT_URL}`);
}

/**
 * The `/auth/confirm` link inside an auth email, re-pointed at the server under test. GoTrue
 * builds the link from config.toml `site_url` (port 3000) while Playwright serves the app on
 * its own port, so only the path and query are kept: a link that only opens because a stray
 * dev server happens to listen on 3000 would hide exactly the failure CI sees.
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

/** Removes every message so a re-run never picks up an older link. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
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
