import { NextResponse } from "next/server";

import { completeDriveConnect } from "@/core/drive/connect";
import { captureException } from "@/core/observability/capture";

/**
 * Google's redirect after the Owner's consent (v4.0): the redirect URI registered in the Google
 * Cloud console, `<app origin>/api/drive/callback`. Checks the `state`, stores the connection and
 * returns to Settings → Google Drive with what happened (`?drive=`). An unexpected failure is
 * reported to Sentry (never with a token or the code) and shown as "failed".
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let target: string;
  try {
    target = await completeDriveConnect(url.searchParams);
  } catch (error) {
    captureException(error);
    target = "/settings/drive?drive=failed";
  }
  return NextResponse.redirect(new URL(target, request.url), 303);
}
