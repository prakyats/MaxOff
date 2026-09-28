"use server";

import { redirect, RedirectType } from "next/navigation";

import { createServerSupabase, type ServerSupabase } from "@/core/db/server";
import { AppError, action, ok, type Result } from "@/core/errors";
import { setSentryUser } from "@/core/observability/user";
import type { MemberRole } from "@/core/permissions";
import { homeFor } from "@/core/ui/shell/nav";

import { LOGIN_PATH, safeNextPath, WELCOME_PATH } from "./paths";
import {
  type LoginInput,
  loginSchema,
  type PasswordResetInput,
  passwordResetSchema,
  type SetPasswordInput,
  setPasswordSchema,
} from "./schemas";
import { setHomeHint } from "./server";
import { sessionMetaArgs } from "./session-meta";

/**
 * The sign-in, sign-out and password actions (ARCHITECTURE §4.2: zod → Supabase Auth →
 * transition function → redirect, wrapped in `action()` so the form only ever sees a
 * `Result`). Session events go through `session_login()` / `session_sign_out()` (1.2 and 3b.1
 * migrations); nothing here writes a table directly.
 */

const INACTIVE_MESSAGE = "This account is not active. Ask the Owner.";

/** The caller's own status, whatever it is (RLS shows the row only to active members). */
async function memberStatus(supabase: ServerSupabase) {
  const { data, error } = await supabase.rpc("member_self_status");
  if (error) throw error;
  return data;
}

/** The caller's own role (RLS shows an active member their own row). */
async function ownRole(supabase: ServerSupabase, userId: string): Promise<MemberRole> {
  const { data, error } = await supabase.from("members").select("role").eq("id", userId).single();
  if (error) throw error;
  return data.role;
}

/**
 * Records the login and refuses (ending the session) anyone who is not an active member.
 * Returns the role, and sets the home hint from it (2.7): the caller redirects straight to the
 * role's home, and the next cold start's `/` is answered by the proxy.
 */
async function recordLoginOrSignOut(supabase: ServerSupabase, userId: string): Promise<MemberRole> {
  if ((await memberStatus(supabase)) !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    throw new AppError("FORBIDDEN", INACTIVE_MESSAGE);
  }
  const { error } = await supabase.rpc("session_login", await sessionMetaArgs());
  if (error) {
    await supabase.auth.signOut({ scope: "local" });
    throw error;
  }
  setSentryUser(userId);
  const role = await ownRole(supabase, userId);
  await setHomeHint(userId, role);
  return role;
}

export const login = action(async (input: LoginInput): Promise<Result<never>> => {
  const { email, password, next } = loginSchema.parse(input);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const role = await recordLoginOrSignOut(supabase, data.user.id);
  // Straight to the role's home (not through `/`, one hop fewer, 2.7); the optional `next`
  // wins when it is a safe path. Replace, never push: a server action's redirect adds history
  // by default, and sign-in is a one-time screen that must not sit under home (§14.2 e).
  redirect(safeNextPath(next) ?? homeFor(role), RedirectType.replace);
});

/**
 * "Sign out of this device" (ADR-0012 amendment 2026-09-27, PRODUCT §4.2): for a lost or shared
 * device only. It ends this device's session and records `session_events(logout)`; it is **not**
 * attendance (`session_sign_out()` never touches the day). Other signed-in devices stay in. A
 * session whose member is no longer active can't record anything (UNAUTHENTICATED from the
 * function) and is simply ended.
 */
export const logout = action(async (): Promise<Result<never>> => {
  const supabase = await createServerSupabase();
  const { data: claims } = await supabase.auth.getClaims();

  if (claims?.claims.sub) {
    const { error } = await supabase.rpc("session_sign_out", await sessionMetaArgs());
    if (error && error.message !== "UNAUTHENTICATED") throw error;
  }

  await supabase.auth.signOut({ scope: "local" });
  setSentryUser(null);
  // Replace: the page you signed out from is not something back should return to (§14.2 e).
  redirect(`${LOGIN_PATH}?reason=signed_out`, RedirectType.replace);
});

/**
 * Sets the password of the current session, opened by a recovery or an invite link through
 * `/auth/confirm`. The status is checked again before anything changes, so a session that
 * turned inactive in between changes nothing and is ended. For an **invited** person this is
 * the accept step: once the password is stored, `member_accept_invite()` makes them active,
 * the login is recorded and they land on their profile.
 */
export const setPassword = action(async (input: SetPasswordInput): Promise<Result<never>> => {
  const { password } = setPasswordSchema.parse(input);
  const supabase = await createServerSupabase();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) throw new AppError("UNAUTHENTICATED", "This link has expired. Ask for a new one.");
  const status = await memberStatus(supabase);
  if (status !== "active" && status !== "invited") {
    await supabase.auth.signOut({ scope: "local" });
    throw new AppError("FORBIDDEN", INACTIVE_MESSAGE);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;

  if (status === "invited") {
    const { error: acceptError } = await supabase.rpc("member_accept_invite");
    if (acceptError) throw acceptError;
    await recordLoginOrSignOut(supabase, userId);
    redirect(WELCOME_PATH, RedirectType.replace);
  }

  const role = await ownRole(supabase, userId);
  await setHomeHint(userId, role);
  // Replace: the set-password screen is one-time and never stays in the back stack (§14.2 e).
  redirect(homeFor(role), RedirectType.replace);
});

/**
 * Sends the recovery email through Supabase Auth (the `recovery` template links to
 * `/auth/confirm`). The answer is the same whether or not the address belongs to a member, so
 * the form can't be used to list the team; only a rate limit is reported.
 */
export const requestPasswordReset = action(
  async (input: PasswordResetInput): Promise<Result<{ sent: true }>> => {
    const { email } = passwordResetSchema.parse(input);
    const supabase = await createServerSupabase();

    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error && error.code?.includes("rate_limit")) throw error;
    // The reply stays uniform, but a broken mail setup must not be invisible: code only.
    if (error) console.error(`[auth] password reset request failed (${error.code ?? "no code"})`);

    return ok({ sent: true });
  },
);
