"use server";

import { action, ok, type Result } from "@/core/errors";
import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/month-close";
import {
  type CloseMonthInput,
  closeMonthSchema,
  type CorrectMonthInput,
  correctMonthSchema,
} from "../domain/month-close";

/**
 * The month close (v3.5 U4; WORKFLOWS §7.4, ARCHITECTURE §4.1): zod → `assertPermission()` → the
 * transition function → revalidate → `Result`. Owner only (`months.close`). Every rule (ended,
 * from the first priced month, once, the note's bounds, "Nothing changed.") is the function's,
 * which audits too; its refusal comes back as the `Result`'s message. Revalidation re-reads every
 * signed-in screen (`revalidateScreens`, ARCHITECTURE §10a), the close screen and Revenue among
 * them. Nobody is notified.
 */

export const closeMonth = action(
  async (input: CloseMonthInput): Promise<Result<{ version: number }>> => {
    const data = closeMonthSchema.parse(input);
    await assertPermission("months.close");
    const version = await repo.rpcCloseMonth(data.month);
    revalidateScreens();
    return ok({ version });
  },
);

export const correctMonth = action(
  async (input: CorrectMonthInput): Promise<Result<{ version: number }>> => {
    const data = correctMonthSchema.parse(input);
    await assertPermission("months.close");
    const version = await repo.rpcCorrectMonth(data.month, data.note);
    revalidateScreens();
    return ok({ version });
  },
);
