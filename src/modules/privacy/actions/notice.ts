"use server";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";
import { revalidateScreens } from "@/core/lib/revalidate-screens";

import * as repo from "../data/reads";
import { PRIVACY_NOTICE_VERSION } from "../domain/notice";

/**
 * "Got it" at the end of Me → Privacy (v7.5 Q1): the member confirms reading **this** version of
 * the notice, so the home screen's card goes. Every member may (their own row only, in the
 * function); no input, so the version is always the one on screen.
 */
export const confirmPrivacyNoticeRead = action(async (): Promise<Result<null>> => {
  if (!(await getCurrentMember())) throw new AppError("UNAUTHENTICATED");
  await repo.rpcNoticeRead(PRIVACY_NOTICE_VERSION);
  revalidateScreens();
  return ok(null);
});
