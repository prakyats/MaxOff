"use server";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";

import { type AppReport, appReportSchema } from "./reachability";
import { rpcAppOpenReport } from "./reachability-store";

/**
 * The app says what it is running on, once per open (task 5.4, owner decision 2026-10-03): its
 * platform and whether it runs installed, which decides "iPhone without MaxOff installed". zod →
 * the member → the RPC → `Result`. Nothing is revalidated: the answer never re-renders a screen,
 * and the caller ignores a failure (the next open reports again).
 */
export const reportAppOpen = action(async (input: AppReport): Promise<Result<null>> => {
  const data = appReportSchema.parse(input);
  const member = await getCurrentMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  await rpcAppOpenReport(data);
  return ok(null);
});
