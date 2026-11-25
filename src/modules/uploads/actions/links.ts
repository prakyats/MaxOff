"use server";

import { headers } from "next/headers";

import { action, AppError, ok, type Result } from "@/core/errors";
import { resolveAppOrigin } from "@/core/lib/app-url";
import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import { assertPermission } from "@/core/permissions/server";

import {
  type FilesReceivedInput,
  filesReceivedSchema,
  type LinkIdInput,
  linkIdSchema,
  type TaskIdInput,
  taskIdSchema,
  type UploaderIdInput,
  uploaderIdSchema,
} from "../domain/schemas";
import { deriveLinkToken, tokenHash, uploadLinkUrl } from "../domain/token";
import { readLinkKey } from "../data/link-key";
import * as repo from "../data/links";
import { uploadService } from "../data/service";

/**
 * The upload link's member actions (v4.5, WORKFLOWS §5B.1, §5B.5; PERMISSIONS `uploads.manage`,
 * `uploads.network`): zod → `assertPermission()` → the transition function → revalidate →
 * `Result`. Who may act on which task (the Owner and the task's three Admins, Q1) is the
 * database's check. The link is worked out again from `UPLOAD_LINK_KEY` each time (plan A3): the
 * token is never stored, only its hash, and it is shown only in the answer to the person who
 * asked (the card), never in a notification or history.
 */

export type UploadLinkAnswer = { linkId: string; url: string };

async function appOrigin(): Promise<string> {
  const head = await headers();
  return resolveAppOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    head.get("host"),
    head.get("x-forwarded-proto"),
    process.env.NEXT_PUBLIC_APP_ENV,
  );
}

function linkKey(): Uint8Array {
  const key = readLinkKey();
  if (key.mode === "off") throw new AppError("INVALID_STATE", key.reason);
  return key.key;
}

/**
 * The link's address, `<origin>/upload#<token>` (the token in the fragment, plan A8), and its
 * hash sealed on the link (write-once: the same hash again is a no-op, so this also seals a link
 * whose first seal never landed). A link sealed with another key works for nobody.
 */
async function linkAddress(linkId: string, copy: boolean, key: Uint8Array): Promise<string> {
  const secret = await repo.rpcLinkSecret(linkId, copy);
  const token = await deriveLinkToken({ key, linkId: secret.linkId, salt: secret.salt });
  const sealed = await uploadService().seal(secret.linkId, await tokenHash(token));
  if (!sealed) {
    throw new AppError(
      "INVALID_STATE",
      "This link was made with an older key and no longer works. Make a new link.",
    );
  }
  return uploadLinkUrl(await appOrigin(), token);
}

/** "Get upload link": a new link for the task, sealed, and its address for the card. */
export const getUploadLink = action(
  async (input: TaskIdInput): Promise<Result<UploadLinkAnswer>> => {
    const data = taskIdSchema.parse(input);
    await assertPermission("uploads.manage");
    const key = linkKey();
    const linkId = await repo.rpcCreateLink(data.taskId);
    const url = await linkAddress(linkId, false, key);
    revalidateScreens();
    return ok({ linkId, url });
  },
);

/** "Copy link": the same address again; a history row names who copied it (to trace a leak). */
export const copyUploadLink = action(
  async (input: LinkIdInput): Promise<Result<UploadLinkAnswer>> => {
    const data = linkIdSchema.parse(input);
    await assertPermission("uploads.manage");
    const key = linkKey();
    const url = await linkAddress(data.linkId, true, key);
    return ok({ linkId: data.linkId, url });
  },
);

/** "Stop link" (confirmed on the card): it never works again; a file on its way may finish. */
export const stopUploadLink = action(async (input: LinkIdInput): Promise<Result<null>> => {
  const data = linkIdSchema.parse(input);
  await assertPermission("uploads.manage");
  await repo.rpcStopLink(data.linkId);
  revalidateScreens();
  return ok(null);
});

/** "Make a new link" (Q9): the active link stops at once and a new one is made and sealed. */
export const renewUploadLink = action(
  async (input: TaskIdInput): Promise<Result<UploadLinkAnswer>> => {
    const data = taskIdSchema.parse(input);
    await assertPermission("uploads.manage");
    const key = linkKey();
    const linkId = await repo.rpcRenewLink(data.taskId);
    const url = await linkAddress(linkId, false, key);
    revalidateScreens();
    return ok({ linkId, url });
  },
);

/**
 * "All files received" (§5B.5): stops the link, then marks the task Done through the existing
 * Done (the caller is the primary owner or a freelancer primary's coordinator, and asked to) or
 * tells the primary owner "mark it done". Past the due time the database asks for the late
 * reason (REASON_REQUIRED), as Done does today.
 */
export const markFilesReceived = action(
  async (input: FilesReceivedInput): Promise<Result<{ path: "marked_done" | "primary_told" }>> => {
    const data = filesReceivedSchema.parse(input);
    await assertPermission("uploads.manage");
    const path = await repo.rpcFilesReceived({
      linkId: data.linkId,
      markDone: data.markDone,
      lateReason: data.lateReason ?? null,
    });
    revalidateScreens();
    dispatchPushSoon();
    return ok({ path });
  },
);

/** The Owner erases an uploader's IP, browser and device key now (plan I4, `uploads.network`). */
export const eraseUploaderNetwork = action(
  async (input: UploaderIdInput): Promise<Result<{ erased: boolean }>> => {
    const data = uploaderIdSchema.parse(input);
    await assertPermission("uploads.network");
    const erased = await repo.rpcEraseNetwork(data.uploaderId);
    revalidateScreens();
    return ok({ erased });
  },
);
