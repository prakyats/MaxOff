import type { MemberRole } from "@/core/permissions";

/**
 * Two-step sign-in (v7.5 Q2, owner 2026-11-26): **required for the Owner**, optional for Admins, not
 * offered to Crew. The factor is Supabase Auth's (TOTP, an authenticator app); the app decides who
 * must pass it. Pure, so the session's check and the tests share one answer.
 *
 * A session needs the second step when it has not passed one (its token's `aal` is not `aal2`) and
 * either the member is the Owner while the environment requires it (`OWNER_MFA_REQUIRED=on`:
 * production; staging until its Owner's secret is in GitHub, docs/runbooks/two-step-sign-in.md), or
 * the member turned it on (`members.second_step`, set only from a session that passed it).
 */
export function needsSecondStep(input: {
  role: MemberRole;
  secondStep: boolean;
  aal: string | null | undefined;
  ownerRequired: boolean;
}): boolean {
  if (input.aal === "aal2") return false;
  return (input.role === "owner" && input.ownerRequired) || input.secondStep;
}

/** Who may set it up: the Owner and Admins (Crew is not offered it). */
export function offersSecondStep(role: MemberRole): boolean {
  return role === "owner" || role === "admin";
}

/** Whether this environment requires the Owner's second step (`OWNER_MFA_REQUIRED`, server only). */
export function ownerSecondStepRequired(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.OWNER_MFA_REQUIRED === "on";
}
