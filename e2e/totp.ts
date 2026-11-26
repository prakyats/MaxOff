import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expect, type Page } from "@playwright/test";

import { totpCode } from "../scripts/lib/totp.mjs";
import { systemClock } from "../src/core/time";

/**
 * Two-step sign-in in the e2e runs (v7.5 Q2; the server runs with OWNER_MFA_REQUIRED=on, as in
 * production). The first sign-in of a member who must pass it sets up their authenticator through
 * the real screen and keeps its key in `e2e/.auth/` (git-ignored, beside the saved sessions); every
 * later sign-in answers the code step from it. A reset database has no authenticator, so the first
 * sign-in after `pnpm db:reset` sets it up again and replaces the key.
 */
function keyFile(email: string): string {
  return `e2e/.auth/totp-${email.replace(/[^a-z0-9]+/gi, "_")}.txt`;
}

export function keyFor(email: string): string | null {
  const file = keyFile(email);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

export function codeFor(email: string): string {
  const key = keyFor(email);
  if (!key) throw new Error(`no authenticator key kept for ${email}: sign in once to set it up`);
  return totpCode(key, systemClock().getTime());
}

/**
 * On `/second-step` after a password: sets the authenticator up (keeping its key) when the screen
 * asks, then enters the code. Returns once the browser has gone on.
 */
export async function answerSecondStep(page: Page, email: string): Promise<void> {
  const setup = page.locator('[data-slot="second-step-setup"]');
  const code = page.locator('[data-slot="second-step-code"]');
  // The loading screen draws the code step disabled: wait for the page itself.
  await expect(page.locator('[data-slot="second-step-loading"]')).toHaveCount(0);
  await expect(setup.or(code)).toBeVisible();
  if (await setup.isVisible()) {
    await setup.click();
    const secret = (await page.locator('[data-slot="second-step-secret"]').innerText()).trim();
    mkdirSync(dirname(keyFile(email)), { recursive: true });
    writeFileSync(keyFile(email), secret);
  }
  await code.fill(codeFor(email));
  await page.locator('[data-slot="second-step-continue"]').click();
  await expect(page).not.toHaveURL(/\/second-step/);
}
