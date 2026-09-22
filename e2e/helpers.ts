import { expect, type Page } from "@playwright/test";

/** The local sign-ins created by `supabase/seed.sql` (README → "Local sign-ins"). */
export const USERS = {
  owner: { email: "owner@maxoff.local", password: "owner-local-password", home: "/today" },
  admin: { email: "admin@maxoff.local", password: "admin-local-password", home: "/today" },
  staff: { email: "staff@maxoff.local", password: "staff-local-password", home: "/my-day" },
  deactivated: { email: "gone@maxoff.local", password: "gone-local-password", home: null },
  /** Only the recovery flow uses this one, since that test changes its password. */
  reset: { email: "reset@maxoff.local", password: "reset-local-password", home: "/my-day" },
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

/** Removes every message so a re-run never picks up an older link. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}
