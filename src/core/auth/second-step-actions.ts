"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createServerSupabase, type ServerSupabase } from "@/core/db/server";
import { AppError, action, ok, type Result } from "@/core/errors";
import { homeFor } from "@/core/ui/shell/nav";

import { safeNextPath } from "./paths";
import { offersSecondStep, ownerSecondStepRequired } from "./second-step";
import { getSessionState } from "./server";

/**
 * Two-step sign-in's actions (v7.5 Q2, owner 2026-11-26; `second-step.ts` says who needs it). The
 * factor is Supabase Auth's TOTP (an authenticator app); `members.second_step` is changed only by
 * `second_step_set()`, from a session that passed the second step. Wrapped in `action()`, so a form
 * only ever sees a `Result`.
 */

const FRIENDLY_NAME = "MaxOff";
const CODE_MESSAGE = "Enter the 6-digit code from your authenticator app.";
const WRONG_CODE_MESSAGE =
  "That code didn't work. Check the time on your phone is right, then try the newest code.";

const codeSchema = z.object({
  code: z
    .string()
    .transform((value) => value.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, CODE_MESSAGE)),
  next: z.string().optional(),
});

/** The signed-in person this step is for: someone who needs it, or the Owner or an Admin setting it up. */
async function personForStep() {
  const state = await getSessionState();
  if (state.kind === "second-step") return { member: state.member, required: true };
  if (state.kind === "member" && offersSecondStep(state.member.role)) {
    return { member: state.member, required: false };
  }
  throw new AppError(state.kind === "member" ? "FORBIDDEN" : "UNAUTHENTICATED");
}

async function totpFactors(supabase: ServerSupabase) {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.all.filter((factor) => factor.factor_type === "totp");
}

/**
 * Starts setting the app up: a new TOTP factor, unverified until its first code. Any earlier
 * unfinished set-up is removed first (each leaves an unverified factor behind). Refused when one is
 * already set up: the code step is the way in then.
 */
export const startSecondStepSetup = action(
  async (): Promise<Result<{ factorId: string; qrCode: string; secret: string }>> => {
    await personForStep();
    const supabase = await createServerSupabase();
    const factors = await totpFactors(supabase);
    if (factors.some((factor) => factor.status === "verified")) {
      throw new AppError("CONFLICT", "An authenticator app is already set up. Enter its code.");
    }
    for (const factor of factors) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: FRIENDLY_NAME,
    });
    if (error) throw error;
    return ok({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
  },
);

/**
 * The code from the app: the session passes the second step (`aal2`), the member's own
 * `second_step` turns on (from now on every sign-in asks), and the browser goes on to `next` or
 * home. A wrong code says so and changes nothing.
 */
export const verifySecondStep = action(
  async (input: { code: string; next?: string }): Promise<Result<never>> => {
    const data = codeSchema.parse(input);
    const { member } = await personForStep();
    const supabase = await createServerSupabase();
    const factors = await totpFactors(supabase);
    // The verified one, or (setting up) the one just enrolled.
    const factor =
      factors.find((candidate) => candidate.status === "verified") ??
      factors.find((candidate) => candidate.status === "unverified");
    if (!factor) throw new AppError("CONFLICT", "Set up your authenticator app first.");
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: data.code,
    });
    // A wrong code is the person's to fix; anything else (GoTrue down, a clash) is not their code.
    if (error && error.code === "mfa_verification_failed") {
      throw new AppError("VALIDATION", undefined, { fieldErrors: { code: [WRONG_CODE_MESSAGE] } });
    }
    if (error) throw error;
    const { error: flagError } = await supabase.rpc("second_step_set", { p_on: true });
    if (flagError) throw flagError;
    redirect(safeNextPath(data.next) ?? homeFor(member.role));
  },
);

/**
 * An Admin turns two-step sign-in off (Me). Not the Owner while this environment requires it.
 * From a session that passed it: the flag first (`second_step_set` refuses a password-only
 * session), then the factor.
 */
export const turnOffSecondStep = action(async (): Promise<Result<null>> => {
  const state = await getSessionState();
  if (state.kind !== "member") throw new AppError("UNAUTHENTICATED");
  if (state.member.role === "owner" && ownerSecondStepRequired()) {
    throw new AppError("FORBIDDEN", "Two-step sign-in is required for the Owner.");
  }
  if (!offersSecondStep(state.member.role)) throw new AppError("FORBIDDEN");
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("second_step_set", { p_on: false });
  if (error) throw error;
  for (const factor of await totpFactors(supabase)) {
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrollError) throw unenrollError;
  }
  return ok(null);
});
