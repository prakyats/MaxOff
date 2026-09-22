import type { NextRequest } from "next/server";

import { updateSession } from "@/core/auth/session";

/**
 * Next 16 proxy (Node runtime; bundled by OpenNext as Node middleware). It only refreshes the
 * session cookies and redirects from the JWT alone; every real decision lives in `core/auth`
 * (ADR-0011 rule 3, ADR-0012). Static assets and the PWA files are excluded so `/offline`,
 * `sw.js` and the manifest never depend on a session.
 */
export default function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icons/|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|svg|ico|webp|txt)$).*)",
  ],
};
