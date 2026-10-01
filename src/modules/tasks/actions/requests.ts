"use server";

import { revalidatePath } from "next/cache";

import { validateCustomFieldsFor } from "@/core/custom-fields/server";
import { action, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/requests";
import {
  type ConvertRequestInput,
  convertRequestSchema,
  type CreateRequestInput,
  createRequestSchema,
  type DeclineRequestInput,
  declineRequestSchema,
  type RequestIdInput,
  requestIdSchema,
} from "../domain/schemas";

/**
 * Task requests (4.6; PRODUCT §4.6, WORKFLOWS §3.4): suggest (`task_requests.create`: Staff and
 * Admins), withdraw (the requester, while it waits), decline with a reason or convert into a
 * task (`task_requests.decide`: the Owner and Admins, the ones they see). Each is a
 * `task_request_*` transition function: the state, the scope and the audit are the database's.
 */

const REQUESTS_PATH = "/tasks/requests";

function refresh(): void {
  // "Needs you" on /tasks counts the suggestions to decide; the whole tree carries the badges.
  revalidatePath("/", "layout");
}

export const createRequest = action(
  async (input: CreateRequestInput): Promise<Result<{ id: string }>> => {
    const data = createRequestSchema.parse(input);
    await assertPermission("task_requests.create");
    const id = await repo.rpcCreateRequest(data);
    revalidatePath(REQUESTS_PATH);
    revalidatePath("/tasks");
    dispatchPushSoon();
    return ok({ id });
  },
);

export const withdrawRequest = action(async (input: RequestIdInput): Promise<Result<null>> => {
  const { requestId } = requestIdSchema.parse(input);
  await assertPermission("task_requests.create");
  await repo.rpcWithdrawRequest(requestId);
  refresh();
  return ok(null);
});

export const declineRequest = action(async (input: DeclineRequestInput): Promise<Result<null>> => {
  const data = declineRequestSchema.parse(input);
  await assertPermission("task_requests.decide");
  await repo.rpcDeclineRequest(data.requestId, data.reason);
  refresh();
  dispatchPushSoon();
  return ok(null);
});

/** The create dialog's fields for this request: the task and the conversion in one transaction. */
export const convertRequest = action(
  async (input: ConvertRequestInput): Promise<Result<{ id: string }>> => {
    const data = convertRequestSchema.parse(input);
    // task_request_convert() checks the decision, then task_create() the task (tasks.create).
    await assertPermission("task_requests.decide");
    const customFields = await validateCustomFieldsFor("task", data.customFields, {
      taskTypeId: data.taskTypeId,
    });
    const id = await repo.rpcConvertRequest(
      data.requestId,
      { ...data, customFields },
      {
        approvingAdminId: data.approvingAdminId,
        stages: data.stages,
        templateId: data.templateId,
        warnings: data.warnings.map((warning) => ({
          kind: warning.kind,
          member_id: warning.memberId,
          details: warning.details,
        })),
      },
    );
    refresh();
    dispatchPushSoon();
    return ok({ id });
  },
);
