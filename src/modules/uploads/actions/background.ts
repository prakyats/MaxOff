import "server-only";

import type { Fetch } from "@/core/drive/google";
import { driveFilesSeen } from "@/core/drive/upload-session";
import { assertPermission } from "@/core/permissions/server";
import { type Clock, systemClock } from "@/core/time";

import type { UploadCard, UploaderSheet } from "../domain/card";
import { driveCheckSchema, taskIdSchema, uploaderIdSchema } from "../domain/schemas";
import * as repo from "../data/links";
import { serviceClient, uploadService } from "../data/service";

/**
 * The Uploads card's **background calls** (ARCHITECTURE §4.4): plain server functions behind
 * route handlers (`/api/uploads/*`), because the card re-reads itself while something uploads
 * (WORKFLOWS §5B.3, the written exception to §10a) and the sheet's Drive check runs after the
 * sheet is on screen, both from effects, where a server action would hold a navigation. Each is
 * zod → `assertPermission()` → the repository; nothing is revalidated.
 */

/** `GET /api/uploads/card?task=`: the card, re-read while something is uploading. */
export async function readUploadCardFor(input: unknown): Promise<UploadCard> {
  const data = taskIdSchema.parse(input);
  await assertPermission("uploads.manage");
  return repo.readUploadCard(data.taskId);
}

/** `GET /api/uploads/sheet?uploader=`: one uploader's sheet. Never waits on Google. */
export async function readUploaderSheetFor(input: unknown): Promise<UploaderSheet> {
  const data = uploaderIdSchema.parse(input);
  await assertPermission("uploads.manage");
  return repo.readUploaderSheet(data.uploaderId);
}

/**
 * `POST /api/uploads/drive-check` ("Removed in Drive", Q7; DATA-MODEL §8a): sent by the sheet once
 * it is on screen, never on the task page's first render. The caller's own read of the sheet is
 * the permission and scope check (`upload_uploader_files`); then the sheet's received files not
 * checked in the last 10 minutes are claimed (`upload_drive_check_claim`, which stamps them, so
 * two Admins on one sheet read Drive once), Drive is asked for each one's metadata, and only a
 * 404 or the bin marks a file (`upload_drive_seen`). Answers the sheet as it now stands.
 */
export async function checkUploaderFilesInDrive(
  input: unknown,
  deps: { fetchImpl?: Fetch; clock?: Clock } = {},
): Promise<UploaderSheet> {
  const data = driveCheckSchema.parse(input);
  await assertPermission("uploads.manage");
  const sheet = await repo.readUploaderSheet(data.uploaderId);
  const onSheet = new Set(sheet.files.map((file) => file.id));
  const fileIds = data.fileIds.filter((id) => onSheet.has(id));
  if (fileIds.length === 0) return sheet;

  const now = (deps.clock ?? systemClock)();
  const service = serviceClient();
  const svc = uploadService(service);
  const claimed = await svc.driveCheckClaim(data.uploaderId, fileIds, now);
  if (claimed.length === 0) return sheet;
  const orgId = await svc.uploaderOrg(data.uploaderId);
  if (!orgId) return sheet;

  let seen: Awaited<ReturnType<typeof driveFilesSeen>>;
  try {
    seen = await driveFilesSeen({
      service,
      orgId,
      driveFileIds: claimed.map((file) => file.drive_file_id),
      fetchImpl: deps.fetchImpl ?? fetch,
      now,
    });
  } catch {
    // The Drive needs reconnecting or Google is down: nothing is marked (DATA-MODEL §8a).
    return sheet;
  }
  let changed = false;
  for (const file of claimed) {
    const outcome = seen.get(file.drive_file_id);
    // The sheet's check reads received files only: a file there stays as it is.
    if (!outcome || outcome === "present") continue;
    await svc.driveSeen(file.file_id, outcome, now);
    changed = true;
  }
  return changed ? repo.readUploaderSheet(data.uploaderId) : sheet;
}
