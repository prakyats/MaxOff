import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";
import { setSentryUser } from "@/core/observability/user";

import { LOGIN_PATH } from "./paths";
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
  const { data: claims } = await supabase.auth.getClaims();
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

export type { CurrentMember } from "./types";
