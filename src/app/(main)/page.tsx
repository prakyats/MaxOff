import { redirect } from "next/navigation";

import { LOGIN_PATH } from "@/core/auth/paths";
import { getSessionState, SIGN_OUT_INACTIVE_PATH } from "@/core/auth/server";
import { homeFor } from "@/core/ui/shell/nav";

/**
 * `/` is a router, not a landing page (the app is internal): a member goes to their role's
 * home, a session whose member is not active is ended, and everyone else signs in.
 *
 * Since 2.7 this is the **fallback**: the proxy answers `/` itself (signed out → /login, a
 * valid home hint → the home; `core/auth/home-hint.ts`). It renders only for a signed-in
 * person with no usable hint, and reads the member row to decide.
 */
export default async function Home() {
  const state = await getSessionState();
  if (state.kind === "member") redirect(homeFor(state.member.role));
  redirect(state.kind === "inactive" ? SIGN_OUT_INACTIVE_PATH : LOGIN_PATH);
}
