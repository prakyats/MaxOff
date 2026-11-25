import "server-only";

import { z } from "zod";

import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/handin";

/**
 * v5.0 hand-in's **background calls** (ARCHITECTURE §4.4): what the upload engine sends on its
 * own while files go to Google (start each file, report progress, say a file finished or
 * failed) and the card's re-read. Plain server functions behind `app/api/handin/*`, never server
 * actions, so a navigation is never held behind them. Each is zod → the permission → the
 * repository; the database decides the rest (DATA-MODEL §8b).
 */

const taskSchema = z.object({ taskId: z.uuid() });

const startSchema = z.object({
  taskId: z.uuid(),
  name: z.string().min(1).max(1000),
  relativePath: z.string().max(4000),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().max(200).nullable(),
  onBehalfOf: z.uuid().nullable(),
});

const progressSchema = z.object({
  fileId: z.uuid(),
  bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const failSchema = z.object({
  fileId: z.uuid(),
  reason: z.enum(["damaged", "gave_up", "unreadable"]),
});

const finishSchema = z.object({
  fileId: z.uuid(),
  driveFileId: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\w-]+$/),
  md5: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
});

/** `GET /api/handin/versions?task=…`: the card's re-read while files upload. */
export async function readHandinVersions(input: unknown): Promise<repo.HandinRead> {
  const { taskId } = taskSchema.parse(input);
  await assertPermission("tasks.work");
  return repo.readHandin(taskId);
}

/** `POST /api/handin/start`: one chosen file. */
export async function startHandinFile(input: unknown): Promise<repo.StartAnswer> {
  const data = startSchema.parse(input);
  await assertPermission("tasks.work");
  return repo.startFile(data);
}

/** `POST /api/handin/progress`. */
export async function reportHandinProgress(input: unknown): Promise<null> {
  const data = progressSchema.parse(input);
  await assertPermission("tasks.work");
  await repo.reportProgress(data.fileId, data.bytes);
  return null;
}

/** `POST /api/handin/fail`. */
export async function failHandinFile(input: unknown): Promise<null> {
  const data = failSchema.parse(input);
  await assertPermission("tasks.work");
  await repo.markFailed(data.fileId, data.reason);
  return null;
}

/** `POST /api/handin/finish`: Google said the file is complete; the Worker checks it itself. */
export async function finishHandinFile(input: unknown): Promise<{ state: "done" | "failed" }> {
  const data = finishSchema.parse(input);
  await assertPermission("tasks.work");
  return { state: await repo.finishFile(data) };
}
