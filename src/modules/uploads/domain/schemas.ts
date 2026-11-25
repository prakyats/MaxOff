/**
 * The member actions' inputs (v4.5, WORKFLOWS §5B.1, §5B.3, §5B.5). The database checks who may
 * act and on which task; these only shape the call.
 */
import { z } from "zod";

const uuid = (what: string) => z.uuid({ error: `Unknown ${what}.` });

export const taskIdSchema = z.object({ taskId: uuid("task") });
export const linkIdSchema = z.object({ linkId: uuid("link") });
export const uploaderIdSchema = z.object({ uploaderId: uuid("uploader") });

export const filesReceivedSchema = z.object({
  linkId: uuid("link"),
  markDone: z.boolean(),
  // Asked for past the task's due time, as Done asks today (the database says when).
  lateReason: z
    .string()
    .trim()
    .max(500, { error: "Keep the reason under 500 characters." })
    .transform((value) => (value === "" ? null : value))
    .nullish(),
});

/** The sheet's own files, checked in Drive after the sheet is on screen (Q7). */
export const driveCheckSchema = z.object({
  uploaderId: uuid("uploader"),
  fileIds: z.array(uuid("file")).max(500),
});

export type TaskIdInput = z.infer<typeof taskIdSchema>;
export type LinkIdInput = z.infer<typeof linkIdSchema>;
export type UploaderIdInput = z.infer<typeof uploaderIdSchema>;
export type FilesReceivedInput = z.input<typeof filesReceivedSchema>;
export type DriveCheckInput = z.infer<typeof driveCheckSchema>;
