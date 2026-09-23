"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createServerSupabase, type ServerSupabase } from "@/core/db/server";
import { AppError, action, ok, type Result } from "@/core/errors";
import { setSentryUser } from "@/core/observability/user";

import { sessionIpHashSalt } from "./env";
import { LOGIN_PATH, safeNextPath, WELCOME_PATH } from "./paths";
import { sessionMetaFrom } from "./request-meta";
import {
  type LoginInput,
  loginSchema,
  type PasswordResetInput,
  passwordResetSchema,
  type SetPasswordInput,
  setPasswordSchema,
} from "./schemas";

/**
 * The sign-in, sign-out and password actions (ARCHITECTURE §4.2: zod → Supabase Auth →
 * transition function → redirect, wrapped in `action()` so the form only ever sees a
 * `Result`). Session events go through `session_login()` / `session_logout()` (1.2 migration);
 * nothing here writes a table directly.
 */

const INACTIVE_MESSAGE = "This account is not active. Ask the Owner.";

/** The RPC arguments; absent values are left out rather than passed as undefined. */
async function sessionMeta(): Promise<{ user_agent?: string; ip_hash?: string }> {
  const { userAgent, ipHash } = await sessionMetaFrom(await headers(), sessionIpHashSalt());
  return {
    ...(userAgent ? { user_agent: userAgent } : {}),
    ...(ipHash ? { ip_hash: ipHash } : {}),
  };
}

/** The caller's own status, whatever it is (RLS shows the row only to active members). */
async function memberStatus(supabase: ServerSupabase) {
  const { data, error } = await supabase.rpc("member_self_status");
  if (error) throw error;
  return data;
}

/** Records the login and refuses (ending the session) anyone who is not an active member. */
async function recordLoginOrSignOut(supabase: ServerSupabase, userId: string): Promise<void> {
  if ((await memberStatus(supabase)) !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    throw new AppError("FORBIDDEN", INACTIVE_MESSAGE);
  }
  const { error } = await supabase.rpc("session_login", await sessionMeta());
  if (error) {
    await supabase.auth.signOut({ scope: "local" });
    throw error;
  }
  setSentryUser(userId);
}

export const login = action(async (input: LoginInput): Promise<Result<never>> => {
  const { email, password, next } = loginSchema.parse(input);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  await recordLoginOrSignOut(supabase, data.user.id);
  // `/` sends a member to their role's home; the optional `next` wins when it is a safe path.
  redirect(safeNextPath(next) ?? "/");
});

/**
 * Logout is manual and its time is recorded immediately (PRODUCT §4.1). This device only:
 * other signed-in devices stay in (decided 2026-09-22). A session whose member is no longer
 * active can't record anything (UNAUTHENTICATED from the function) and is simply ended.
 */
export const logout = action(async (): Promise<Result<never>> => {
  const supabase = await createServerSupabase();
  const { data: claims } = await supabase.auth.getClaims();

  if (claims?.claims.sub) {
    const { error } = await supabase.rpc("session_logout", await sessionMeta());
    if (error && error.message !== "UNAUTHENTICATED") throw error;
  }

  await supabase.auth.signOut({ scope: "local" });
  setSentryUser(null);
  redirect(`${LOGIN_PATH}?reason=signed_out`);
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
    redirect(WELCOME_PATH);
  }

  redirect("/");
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
