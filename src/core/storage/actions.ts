"use server";

import { z } from "zod";

import { getCurrentMember } from "@/core/auth/server";
import { action, AppError, ok, type Result } from "@/core/errors";
import { can } from "@/core/permissions";

import { StorageError } from "./adapter";
import {
  checkFile,
  FILE_NAME_MAX,
  FILE_PURPOSES,
  MULTIPART_THRESHOLD,
  partCount,
  PRESIGN_DOWNLOAD_SECONDS,
  PRESIGN_UPLOAD_SECONDS,
  SVG_MIME,
} from "./limits";
import { completeFile, createPendingFile, failFile, getFile, getStorageAdapter } from "./server";
import { sanitiseSvg, SvgSanitiseError } from "./svg";

/**
 * The upload protocol (ARCHITECTURE §11): `beginUpload` checks permission, type and size,
 * creates the pending row and returns presigned URLs (one PUT, or one per part); the browser
 * uploads straight to the bucket; `completeUpload` confirms the object is there, sanitises an
 * SVG in place, and marks the row ready. `failUpload` records a browser that gave up, so the
 * cleanup job removes any partial object. `getDownloadUrl` signs a short-lived GET.
 */

const beginSchema = z.object({
  purpose: z.enum(FILE_PURPOSES),
  name: z.string().trim().min(1, "The file has no name.").max(FILE_NAME_MAX),
  mime: z
    .string()
    .trim()
    .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/, "Unknown file type."),
  size: z.number().int().positive("This file is empty."),
  /** The original this upload is a preview of (`preview` purpose only). */
  previewOf: z.uuid().optional(),
});
export type BeginUploadInput = z.input<typeof beginSchema>;

export type UploadPlan =
  | { kind: "single"; url: string }
  | {
      kind: "multipart";
      uploadId: string;
      partSize: number;
      parts: { partNumber: number; url: string }[];
    };

export type BeginUploadResult = {
  fileId: string;
  plan: UploadPlan;
};

export const beginUpload = action(
  async (input: BeginUploadInput): Promise<Result<BeginUploadResult>> => {
    const data = beginSchema.parse(input);
    const member = await getCurrentMember();
    if (!member) throw new AppError("UNAUTHENTICATED");
    // A logo is attached under settings.manage (the company) or clients.edit_assigned (a client);
    // anyone may upload their own photo, and a preview belongs to whoever uploads its original.
    if (
      data.purpose === "logo" &&
      !can(member.role, ["settings.manage", "clients.edit_assigned"])
    ) {
      throw new AppError("FORBIDDEN");
    }
    const problem = checkFile(data.purpose, { mime: data.mime, size: data.size });
    if (problem) throw new AppError("VALIDATION", problem, { fieldErrors: { file: [problem] } });
    if ((data.purpose === "preview") !== (data.previewOf !== undefined)) {
      throw new AppError("VALIDATION", "A preview names its original, and only a preview does.");
    }

    const file = await createPendingFile({
      name: data.name,
      mime: data.mime,
      sizeBytes: data.size,
      previewOf: data.previewOf ?? null,
    });
    const storage = getStorageAdapter();
    const expiresIn = PRESIGN_UPLOAD_SECONDS;
    if (data.size <= MULTIPART_THRESHOLD) {
      const url = await storage.presignPut(file.storageKey, { expiresIn });
      return ok({ fileId: file.id, plan: { kind: "single", url } });
    }
    const uploadId = await storage.createMultipart(file.storageKey, data.mime);
    const parts = await Promise.all(
      Array.from({ length: partCount(data.size) }, async (_, index) => ({
        partNumber: index + 1,
        url: await storage.presignPart(file.storageKey, uploadId, index + 1, { expiresIn }),
      })),
    );
    return ok({
      fileId: file.id,
      plan: { kind: "multipart", uploadId, partSize: MULTIPART_THRESHOLD, parts },
    });
  },
);

const completeSchema = z.object({
  fileId: z.uuid(),
  multipart: z
    .object({
      uploadId: z.string().min(1),
      parts: z
        .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) }))
        .min(1),
    })
    .optional(),
});
export type CompleteUploadInput = z.input<typeof completeSchema>;

export const completeUpload = action(
  async (input: CompleteUploadInput): Promise<Result<{ fileId: string }>> => {
    const data = completeSchema.parse(input);
    const member = await getCurrentMember();
    if (!member) throw new AppError("UNAUTHENTICATED");
    const file = await getFile(data.fileId);
    if (!file || file.uploadedBy !== member.id)
      throw new AppError("NOT_FOUND", "This upload does not exist.");
    if (file.status !== "pending")
      throw new AppError("INVALID_STATE", "This upload has already finished.");

    const storage = getStorageAdapter();
    try {
      if (data.multipart) {
        await storage.completeMultipart(
          file.storageKey,
          data.multipart.uploadId,
          data.multipart.parts,
        );
      }
      let object = await storage.head(file.storageKey);
      if (!object) throw new AppError("VALIDATION", "The file did not arrive. Try again.");
      if (object.size !== file.sizeBytes) {
        await storage.delete(file.storageKey);
        await failFile(file.id);
        throw new AppError("VALIDATION", "The uploaded file does not match what was announced.");
      }
      if (file.mime === SVG_MIME) {
        // Kickoff 3 (11): an SVG is rewritten from an allow-list before anyone can fetch it.
        const original = await storage.get(file.storageKey);
        if (!original) throw new AppError("VALIDATION", "The file did not arrive. Try again.");
        const source = await new Response(original.body).text();
        let clean: string;
        try {
          clean = sanitiseSvg(source);
        } catch (error) {
          if (!(error instanceof SvgSanitiseError)) throw error;
          await storage.delete(file.storageKey);
          await failFile(file.id);
          throw new AppError("VALIDATION", "This is not a valid SVG file.", {
            fieldErrors: { file: [error.message] },
          });
        }
        const bytes = new TextEncoder().encode(clean);
        await storage.put(file.storageKey, bytes, SVG_MIME);
        object = { ...object, size: bytes.byteLength };
      }
      await completeFile(file.id, object.size, null);
      return ok({ fileId: file.id });
    } catch (error) {
      if (error instanceof StorageError) {
        throw new AppError("INTERNAL", undefined, { cause: error });
      }
      throw error;
    }
  },
);

const failSchema = z.object({ fileId: z.uuid(), uploadId: z.string().min(1).optional() });
export type FailUploadInput = z.input<typeof failSchema>;

export const failUpload = action(async (input: FailUploadInput): Promise<Result<null>> => {
  const data = failSchema.parse(input);
  const member = await getCurrentMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  const file = await getFile(data.fileId);
  if (!file || file.uploadedBy !== member.id)
    throw new AppError("NOT_FOUND", "This upload does not exist.");
  if (file.status !== "pending") return ok(null);
  if (data.uploadId) {
    try {
      await getStorageAdapter().abortMultipart(file.storageKey, data.uploadId);
    } catch {
      // The cleanup job removes what is left; the row still records the failure.
    }
  }
  await failFile(file.id);
  return ok(null);
});

const downloadSchema = z.object({ fileId: z.uuid() });
export type DownloadUrlInput = z.input<typeof downloadSchema>;

/** A 5-minute link to the original, as an attachment (never inline: SVG and HTML stay downloads). */
export const getDownloadUrl = action(
  async (input: DownloadUrlInput): Promise<Result<{ url: string; name: string }>> => {
    const { fileId } = downloadSchema.parse(input);
    const file = await getFile(fileId);
    if (!file || file.status !== "ready")
      throw new AppError("NOT_FOUND", "This file is not available.");
    const url = await getStorageAdapter().presignGet(file.storageKey, {
      expiresIn: PRESIGN_DOWNLOAD_SECONDS,
      downloadName: file.name,
    });
    return ok({ url, name: file.name });
  },
);
