"use server";

import { z } from "zod";

import { action, ok, type Result } from "@/core/errors";
import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/handin";

/**
 * v5.0 hand-in, the actions (ARCHITECTURE §4: zod → permission → repository → Result). Thin: the
 * rules are the database's (`handin_*`, DATA-MODEL §8b). Leave out is a tap, so it is a server
 * action; the upload's own calls (start, progress, finish, fail) are sent by the upload engine on
 * its own, so they reach route handlers (`app/api/handin/*`, ARCHITECTURE §4.4) that call the
 * functions in `background.ts`.
 */

const leaveOutSchema = z.object({ fileId: z.uuid(), onBehalfOf: z.uuid().nullable() });

export const leaveOutFile = action(
  async (input: z.input<typeof leaveOutSchema>): Promise<Result<null>> => {
    const data = leaveOutSchema.parse(input);
    await assertPermission("tasks.work");
    await repo.leaveOut(data.fileId, data.onBehalfOf);
    revalidateScreens();
    return ok(null);
  },
);
