import type { Metadata } from "next";
import { redirect } from "next/navigation";

// Direct, not via the barrel: see the note in login/page.tsx.
import { SetPasswordForm } from "@/core/auth/components/set-password-form";
import { EXPIRED_LINK_PATH } from "@/core/auth/links";
import { SECOND_STEP_PATH, SET_PASSWORD_PATH } from "@/core/auth/paths";
import { getSessionState } from "@/core/auth/server";

import { SetPasswordIntro } from "./intro";

export const metadata: Metadata = { title: "Set your password" };

/**
 * Reached from a recovery link (`/auth/confirm`). It needs the session that link opened;
 * without one the link was never verified, so back to sign in with the reason.
 */
export default async function SetPasswordPage() {
  const state = await getSessionState();
  if (state.kind === "none") redirect(EXPIRED_LINK_PATH);
  // v7.5 Q2: the Owner (or anyone who turned it on) passes the second step before a new password.
  if (state.kind === "second-step") {
    redirect(`${SECOND_STEP_PATH}?next=${encodeURIComponent(SET_PASSWORD_PATH)}`);
  }

  return (
    <>
      <SetPasswordIntro />
      <SetPasswordForm />
    </>
  );
}
