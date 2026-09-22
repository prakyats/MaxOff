import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { verifyAuthLink } from "@/core/auth/links";

export const dynamic = "force-dynamic";

/** Where every auth email link lands (ADR-0012). The decision is `core/auth`'s. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = await verifyAuthLink({
    tokenHash: params.get("token_hash"),
    type: params.get("type"),
    headers: request.headers,
  });
  redirect(target);
}
