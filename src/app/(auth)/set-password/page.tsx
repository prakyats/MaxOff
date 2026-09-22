import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SetPasswordForm } from "@/core/auth/components";
import { EXPIRED_LINK_PATH } from "@/core/auth/links";
import { getSessionState } from "@/core/auth/server";

export const metadata: Metadata = { title: "Set your password" };

/**
 * Reached from a recovery link (`/auth/confirm`). It needs the session that link opened;
 * without one the link was never verified, so back to sign in with the reason.
 */
export default async function SetPasswordPage() {
  const state = await getSessionState();
  if (state.kind === "none") redirect(EXPIRED_LINK_PATH);

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Set your password</h1>
      <p className="text-muted-foreground mb-5 text-sm">
        Choose the password you&apos;ll sign in with from now on.
      </p>
      <SetPasswordForm />
    </>
  );
}
