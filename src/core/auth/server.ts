import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";
import { setSentryUser } from "@/core/observability/user";
import type { MemberRole } from "@/core/permissions";

import { formatHomeHint, HOME_HINT_COOKIE } from "./home-hint";
import { LOGIN_PATH } from "./paths";
import { classifySessionError, SessionUnavailableError } from "./session-errors";
import type { CurrentMember } from "./types";

export const SIGN_OUT_INACTIVE_PATH = "/auth/signout?reason=inactive";

/**
 * What the request's cookies resolve to.
 * - `none`: no verified Supabase session.
 * - `inactive`: a session whose member row is missing, invited or deactivated. Every table is
 *   already closed to them (`app.current_member()` returns no row), and the app treats it as
 *   signed out: `requireMember()` ends the session through `/auth/signout`.
 * - `member`: an active member.
 */
export type SessionState =
  | { kind: "none" }
  | { kind: "inactive"; userId: string }
  | { kind: "member"; member: CurrentMember };

/**
 * Resolves the session once per request (React `cache()`): the JWT is verified with
 * `getClaims()` (JWKS, no round trip once cached), then the member row is read under RLS
 * (own row only). Sets the Sentry user to the member id and nothing else (ARCHITECTURE §18.2).
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createServerSupabase();
  const claims = await readClaims(supabase);
  const userId = claims?.claims.sub;
  if (!userId) return { kind: "none" };

  const { data: row, error } = await supabase
    .from("members")
    .select("id, email, full_name, role, status, job_title:list_items(name)")
    .eq("id", userId)
    .maybeSingle();
  // A failed query (timeout, paused project) must never read as "inactive": that path ends
  // the session. Let the error boundary show a retryable error instead.
  if (error) throw error;

  if (!row || row.status !== "active") return { kind: "inactive", userId };

  setSentryUser(row.id);
  return {
    kind: "member",
    member: {
      id: row.id,
      email: row.email,
      role: row.role,
      name: row.full_name,
      jobTitle: row.job_title?.name ?? null,
    },
  };
});

/**
 * The verified claims, or `null` when there is no usable session. A transient failure at GoTrue
 * (unreachable, 5xx, timeout) must never read as "signed out", which would end the session on
 * the next hop: it throws `SessionUnavailableError`, whose digest the error boundary turns
 * into "You're still signed in, try again" (2.6, owner decision 2026-09-24). An expired or
 * refused session is `null`, as before.
 */
async function readClaims(supabase: Awaited<ReturnType<typeof createServerSupabase>>) {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error && classifySessionError(error) === "transient") {
      throw new SessionUnavailableError(error);
    }
    return data;
  } catch (error) {
    if (error instanceof SessionUnavailableError) throw error;
    throw new SessionUnavailableError(error);
  }
}

/** The signed-in active member, or `null`. The seam every page and guard uses. */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  const state = await getSessionState();
  return state.kind === "member" ? state.member : null;
}

/**
 * For layouts and pages that exist only for members (ADR-0011 rule 3: the decision lives
 * here, not inline). Signed out → `/login` (the proxy already adds `next=` for direct hits);
 * an inactive session is ended first so a deactivated person can't keep a live cookie.
 */
export async function requireMember(): Promise<CurrentMember> {
  const state = await getSessionState();
  if (state.kind === "member") return state.member;
  redirect(state.kind === "inactive" ? SIGN_OUT_INACTIVE_PATH : LOGIN_PATH);
}

/**
 * `/auth/signout` (GET, reached only through `requireMember()`): ends a session whose member
 * is not active and says why on /login. A session that turns out to be fine is not touched,
 * so a pasted link can't log anyone out. Returns where to send the browser.
 */
export async function endInactiveSession(): Promise<string> {
  const state = await getSessionState();
  if (state.kind === "member") return "/";
  if (state.kind === "inactive") {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    // `@supabase/ssr` clears the cookies only when GoTrue answered; on a 5xx they would keep
    // bouncing the visitor between /login and here, so clear them by hand.
    if (error) await clearAuthCookies();
    setSentryUser(null);
    return `${LOGIN_PATH}?reason=inactive`;
  }
  return LOGIN_PATH;
}

async function clearAuthCookies(): Promise<void> {
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith("sb-")) store.delete(cookie.name);
  }
}

/**
 * Sets the home hint the proxy reads to answer `/` (2.7, `home-hint.ts`). A route handler or a
 * server action only. Called at sign-in, set-password and with the day gate's daily pass.
 */
export async function setHomeHint(userId: string, role: MemberRole): Promise<void> {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  (await cookies()).set(HOME_HINT_COOKIE, formatHomeHint(userId, role), {
    httpOnly: true,
    sameSite: "lax",
    secure: appEnv === "staging" || appEnv === "production",
    path: "/",
    // Refreshed at least daily by the gate; the Owner (never gated) refreshes it at sign-in.
    maxAge: 60 * 60 * 24 * 30,
  });
}

export type { CurrentMember } from "./types";
