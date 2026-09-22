import { redirect } from "next/navigation";

import { endInactiveSession } from "@/core/auth/server";

export const dynamic = "force-dynamic";

/** Ends a session whose member is no longer active; `requireMember()` sends people here. */
export async function GET() {
  redirect(await endInactiveSession());
}
