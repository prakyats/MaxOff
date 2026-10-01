"use server";

import { revalidatePath } from "next/cache";

import { action, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/credits";
import {
  type GrantCompLeaveInput,
  grantCompLeaveSchema,
  type RevokeCompLeaveInput,
  revokeCompLeaveSchema,
} from "../domain/schemas";

/**
 * The Owner's comp leave grants and revokes (PRODUCT §4.3a, 3b.2; ARCHITECTURE §4.2): zod →
 * `assertPermission()` → the transition function → revalidate → `Result`. The rules (½ or 1
 * day, the month-end expiry, an unused credit only) live in the functions.
 */

function revalidateCredits(): void {
  // The person's page and the member's own Extra work tab both show the balance.
  revalidatePath("/", "layout");
}

/** A standalone grant, independent of any note (decision 14). */
export const grantCompLeave = action(
  async (input: GrantCompLeaveInput): Promise<Result<{ creditId: string }>> => {
    const data = grantCompLeaveSchema.parse(input);
    await assertPermission("attendance.decide");
    const creditId = await repo.rpcGrant(data.memberId, data.days, data.note, data.requestKey);
    revalidateCredits();
    dispatchPushSoon();
    return ok({ creditId });
  },
);

/** Revoke an unused grant, with a reason the member reads (decision 17). */
export const revokeCompLeave = action(
  async (input: RevokeCompLeaveInput): Promise<Result<null>> => {
    const data = revokeCompLeaveSchema.parse(input);
    await assertPermission("attendance.decide");
    await repo.rpcRevoke(data.creditId, data.reason);
    revalidateCredits();
    dispatchPushSoon();
    return ok(null);
  },
);
