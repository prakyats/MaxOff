import type { MemberRole } from "@/core/permissions";
import { homeFor } from "@/core/ui/shell/nav";

import { LOGIN_PATH } from "./paths";

/**
 * The home hint (task 2.7): lets the proxy answer `/`, the installed app's `start_url`, with one
 * redirect read off a cookie instead of a full server render that reads the member row first
 * (829 ms to produce a 307 on staging, before the real page was even requested).
 *
 * The cookie says "this user's home is /today" (or /my-day). It is a **routing hint, never a
 * decision**: the page it leads to still runs `requireMember()` and every permission check.
 * So it carries no MAC: forging one only sends you to a page you can already open, and the
 * value is bound to the user id so another person signing in on the same device never
 * inherits it. It is set at sign-in and set-password, and refreshed by the day gate's daily
 * pass (`setDayPass` callers), so a role change reaches it within a day at most. Anything the
 * proxy does not recognise falls through to `src/app/page.tsx`, which reads the member; the
 * proxy never redirects `/` to `/`, so a bad hint costs one extra hop and cannot loop.
 */

export const HOME_HINT_COOKIE = "maxoff_home";

/** Only a role's home is ever a target. */
const HOMES: ReadonlySet<string> = new Set([homeFor("owner"), homeFor("admin"), homeFor("staff")]);

/** The cookie value: `<user id>|<home path>`. */
export function formatHomeHint(userId: string, role: MemberRole): string {
  return `${userId}|${homeFor(role)}`;
}

/** The home in the hint when it belongs to this user and names a real home, else null. */
export function readHomeHint(value: string | undefined, userId: string): string | null {
  if (!value) return null;
  const [hintUser, home, ...rest] = value.split("|");
  if (rest.length > 0 || hintUser !== userId || !home || !HOMES.has(home)) return null;
  return home;
}

/**
 * The proxy's answer for `/`: where to redirect, or null to let `src/app/page.tsx` decide.
 * Signed out goes to sign-in (nothing to render first); signed in goes to the hinted home.
 */
export function rootRedirect(userId: string | null, hint: string | undefined): string | null {
  if (!userId) return LOGIN_PATH;
  return readHomeHint(hint, userId);
}
