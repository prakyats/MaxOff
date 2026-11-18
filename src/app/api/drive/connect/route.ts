import { NextResponse } from "next/server";

import { startDriveConnect } from "@/core/drive/connect";

/**
 * Settings → Google Drive → Connect (v4.0, `drive.manage`, Owner only): sends the Owner to
 * Google's consent screen with a fresh `state`, or back to Settings when Drive is not set up
 * here. Anyone else lands on No access. `/api/*` is public in the proxy, so the check is here.
 */
export async function GET(request: Request): Promise<Response> {
  const target = await startDriveConnect();
  return NextResponse.redirect(new URL(target, request.url), 303);
}
