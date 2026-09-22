import { redirect } from "next/navigation";

import { LOGIN_PATH } from "@/core/auth/paths";
import { getSessionState, SIGN_OUT_INACTIVE_PATH } from "@/core/auth/server";
import { homeFor } from "@/core/ui/shell/nav";

/**
 * `/` is a router, not a landing page (the app is internal): a member goes to their role's
 * home, a session whose member is not active is ended, and everyone else signs in.
 */
export default async function Home() {
  const state = await getSessionState();
  if (state.kind === "member") redirect(homeFor(state.member.role));
  redirect(state.kind === "inactive" ? SIGN_OUT_INACTIVE_PATH : LOGIN_PATH);
}
