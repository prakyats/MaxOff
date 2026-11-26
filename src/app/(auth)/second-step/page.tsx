import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SecondStepForm } from "@/core/auth/components/second-step-form";
import { LOGIN_PATH, safeNextPath } from "@/core/auth/paths";
import { offersSecondStep } from "@/core/auth/second-step";
import {
  getSessionState,
  hasVerifiedAuthenticator,
  SIGN_OUT_INACTIVE_PATH,
} from "@/core/auth/server";
import { homeFor } from "@/core/ui/shell/nav";

import { SecondStepIntro } from "./intro";

export const metadata: Metadata = { title: "Two-step sign-in" };

/**
 * The second step of a sign-in (v7.5 Q2, owner 2026-11-26): required for the Owner, optional for
 * Admins (`core/auth/second-step.ts`). A session that needs it lands here from anywhere
 * (`requireMember()`); the Owner or an Admin setting it up from Me comes with `?setup=1`. With a
 * verified authenticator the page asks for its code; without one, it sets one up first.
 */
export default async function SecondStepPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; setup?: string }>;
}) {
  const { next, setup } = await searchParams;
  const state = await getSessionState();
  if (state.kind === "none") redirect(LOGIN_PATH);
  if (state.kind === "inactive") redirect(SIGN_OUT_INACTIVE_PATH);
  const choosing = state.kind === "member" && setup === "1" && offersSecondStep(state.member.role);
  if (state.kind === "member" && !choosing) redirect(homeFor(state.member.role));

  const mode = (await hasVerifiedAuthenticator()) ? "verify" : "setup";
  return (
    <>
      <SecondStepIntro mode={mode} />
      <SecondStepForm mode={mode} next={safeNextPath(next) ?? undefined} />
    </>
  );
}
