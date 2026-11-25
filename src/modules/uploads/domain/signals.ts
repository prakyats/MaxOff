/**
 * The two signals the Admin gets about an uploader (v4.5, WORKFLOWS §5B.4): "Stuck" after 15
 * minutes with work left and no progress, and "Looks finished" after 10 minutes in which every
 * file started is done and nothing moved. Never both; neither once the link has stopped, and
 * "Looks finished" not after the uploader said "I'm done" (advisor, 19 Nov). Pure: the caller
 * passes the uploader's files and the time.
 */

export const STUCK_AFTER_MS = 15 * 60_000;
export const LOOKS_FINISHED_AFTER_MS = 10 * 60_000;

export type UploadFileState = "held" | "uploading" | "done" | "failed" | "missing_in_drive";

export type UploaderActivity = {
  files: readonly { state: UploadFileState }[];
  /** The last time any of the uploader's files made progress (or was added). */
  lastProgressAt: Date;
  saidDone: boolean;
  linkStopped: boolean;
};

export type UploaderSignal = "stuck" | "looks_finished" | null;

export function uploaderSignal(activity: UploaderActivity, now: Date): UploaderSignal {
  if (activity.linkStopped || activity.files.length === 0) return null;
  const quietFor = now.getTime() - activity.lastProgressAt.getTime();
  const workLeft = activity.files.some(
    (file) => file.state === "uploading" || file.state === "held" || file.state === "failed",
  );
  if (workLeft) return quietFor >= STUCK_AFTER_MS ? "stuck" : null;
  if (activity.saidDone) return null;
  return quietFor >= LOOKS_FINISHED_AFTER_MS ? "looks_finished" : null;
}
