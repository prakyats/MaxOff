import { expect, type Page } from "@playwright/test";

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

/** Fills the real sign-in form. Resolves once the browser has left /login. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The first server action after boot can take a while; the form shows any refusal.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
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
