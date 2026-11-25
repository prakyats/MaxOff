import "server-only";

import type { ServiceSupabase } from "@/core/db/service";
import type { Fetch } from "@/core/drive/google";
import { finishedFileProblem, type SessionStatus, sessionStatus } from "@/core/drive/resumable";
import { driveFileFacts, unsealSession } from "@/core/drive/upload-session";

import type { FailedReason } from "../domain/api";
import { failedReasonOf } from "../domain/api";
import type { FileRow, UploadService } from "../data/service";

/**
 * Is a file finished, by **Google's** answer (v4.5 plan F1–F2)? The server asks the session
 * itself for the final file (a browser's claim of another Drive id is ignored), then `files.get`
 * for its size, folder and MD5, and the database records it (`upload_file_done`: done, or failed
 * as `size_mismatch`, `wrong_folder` or `damaged`). Shared by the page's "done" call and the
 * every-minute watch, which finds files that finished after the page went quiet.
 */
export type Verdict =
  | { outcome: "done" }
  | { outcome: "failed"; reason: FailedReason }
  | { outcome: "incomplete"; received: number }
  /** Google has no finished file to show yet (or no longer knows the session): try later. */
  | { outcome: "not_ready" };

export async function verifyFinished(input: {
  svc: UploadService;
  service: ServiceSupabase;
  file: FileRow & { session_uri_encrypted: string; drive_parent_id: string };
  /** The page's own MD5, when it computed one (plan F2); null checks by size only. */
  localMd5: string | null;
  /** What the browser heard from Google: used only when Google has forgotten the session. */
  browserDriveFileId: string | null;
  /** Already asked (the watch); otherwise asked here. */
  status?: SessionStatus;
  fetchImpl: Fetch;
  now: Date;
}): Promise<Verdict> {
  const status =
    input.status ??
    (await sessionStatus(input.fetchImpl, {
      sessionUrl: await unsealSession(input.file.session_uri_encrypted),
      size: input.file.size_bytes,
    }));
  if (status.state === "incomplete") return { outcome: "incomplete", received: status.received };
  // Google keeps a finished session's answer for about a week; past that, the page's own id is
  // checked against the same folder and size, so it can only ever be this upload's own file.
  const driveFileId = status.state === "complete" ? status.file.id : input.browserDriveFileId;
  if (!driveFileId) return { outcome: "not_ready" };

  const facts = await driveFileFacts({
    service: input.service,
    orgId: input.file.org_id,
    driveFileId,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  const md5 = input.localMd5?.toLowerCase() ?? null;
  const problem = finishedFileProblem(facts, {
    sizeBytes: input.file.size_bytes,
    parentId: input.file.drive_parent_id,
    md5,
  });
  if (!facts || problem === "missing") return { outcome: "not_ready" };

  const state = await input.svc.fileDone({
    fileId: input.file.id,
    driveFileId: facts.id,
    size: facts.sizeBytes,
    md5Drive: facts.md5,
    // The database compares it with the folder the session was opened for (wrong_folder).
    parentId: facts.parents.includes(input.file.drive_parent_id)
      ? input.file.drive_parent_id
      : (facts.parents[0] ?? ""),
    md5Page: md5,
  });
  if (state !== "failed") return { outcome: "done" };
  return { outcome: "failed", reason: problem ? failedReasonOf(problem) : "damaged" };
}

/** A file row the checks can work with: one with a session and the folder it was opened for. */
export function hasSession(
  file: FileRow,
): file is FileRow & { session_uri_encrypted: string; drive_parent_id: string } {
  return file.session_uri_encrypted !== null && file.drive_parent_id !== null;
}
