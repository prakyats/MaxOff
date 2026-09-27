"use client";

import type { Result } from "@/core/errors";

import {
  beginUpload,
  completeUpload,
  failUpload,
  type BeginUploadResult,
  type UploadPlan,
} from "../actions";
import {
  checkFile,
  type FilePurpose,
  partRange,
  PREVIEW_MAX_EDGE,
  PREVIEW_QUALITY,
  previewSize,
  SVG_MIME,
} from "../limits";

/**
 * The browser side of an upload (ARCHITECTURE §11): ask the server for a plan, PUT the bytes
 * straight to the bucket (one request, or one per part with a retry each), then tell the
 * server. The original is never re-encoded; for an image a small JPEG **preview** is made here
 * and uploaded as its own file pointing at the original (`preview_of`), which is what lists
 * show (PRODUCT §4.9).
 */

export type UploadOutcome = { ok: true; fileId: string } | { ok: false; message: string };

const PART_ATTEMPTS = 3;

function messageOf(result: Result<unknown>): string {
  if (result.ok) return "";
  return result.error.fieldErrors?.file?.[0] ?? result.error.message;
}

async function putBytes(url: string, body: Blob, contentType: string): Promise<Response> {
  return fetch(url, { method: "PUT", body, headers: { "content-type": contentType } });
}

/** PUTs the file as the plan says; returns what `completeUpload` needs for a multipart upload. */
export async function uploadByPlan(
  plan: UploadPlan,
  file: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<{ uploadId: string; parts: { partNumber: number; etag: string }[] } | undefined> {
  if (plan.kind === "single") {
    const response = await putBytes(plan.url, file, contentType);
    if (!response.ok) throw new Error(`The upload was refused (${response.status}).`);
    onProgress?.(1);
    return undefined;
  }
  const parts: { partNumber: number; etag: string }[] = [];
  for (const part of plan.parts) {
    const { start, end } = partRange(file.size, part.partNumber);
    const slice = file.slice(start, end);
    let etag: string | null = null;
    for (let attempt = 1; attempt <= PART_ATTEMPTS && etag === null; attempt += 1) {
      const response = await putBytes(part.url, slice, contentType);
      if (response.ok) {
        etag = response.headers.get("etag");
        if (!etag)
          throw new Error("The bucket did not return the part's ETag (CORS must expose it).");
      } else if (attempt === PART_ATTEMPTS) {
        throw new Error(`Part ${part.partNumber} was refused (${response.status}).`);
      }
    }
    parts.push({ partNumber: part.partNumber, etag: etag as string });
    onProgress?.(parts.length / plan.parts.length);
  }
  return { uploadId: plan.uploadId, parts };
}

/** One file, end to end. A failure after `beginUpload` is recorded so the object is cleaned up. */
export async function uploadFile({
  purpose,
  file,
  name,
  previewOf,
  onProgress,
}: {
  purpose: FilePurpose;
  file: Blob;
  name: string;
  previewOf?: string;
  onProgress?: (fraction: number) => void;
}): Promise<UploadOutcome> {
  const mime = file.type || "application/octet-stream";
  const problem = checkFile(purpose, { mime, size: file.size });
  if (problem) return { ok: false, message: problem };

  const begun = await beginUpload({
    purpose,
    name,
    mime,
    size: file.size,
    ...(previewOf ? { previewOf } : {}),
  });
  if (!begun.ok) return { ok: false, message: messageOf(begun) };
  const { fileId, plan }: BeginUploadResult = begun.data;

  try {
    const multipart = await uploadByPlan(plan, file, mime, onProgress);
    const done = await completeUpload({ fileId, ...(multipart ? { multipart } : {}) });
    if (!done.ok) return { ok: false, message: messageOf(done) };
    return { ok: true, fileId };
  } catch (error) {
    await failUpload({ fileId, ...(plan.kind === "multipart" ? { uploadId: plan.uploadId } : {}) });
    return { ok: false, message: error instanceof Error ? error.message : "The upload failed." };
  }
}

async function decode(
  file: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (file.type !== SVG_MIME && typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  // An SVG (or an old browser): let the image element rasterise it.
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("This image cannot be read."));
      element.src = url;
    });
    const width = image.naturalWidth || PREVIEW_MAX_EDGE;
    const height = image.naturalHeight || PREVIEW_MAX_EDGE;
    return { source: image, width, height, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * A JPEG of the image at most `PREVIEW_MAX_EDGE` on its long edge, drawn on white (a JPEG has
 * no transparency). Null when the browser cannot decode the file, in which case the original
 * is still uploaded and lists show the fallback.
 */
export async function makeJpegPreview(file: Blob): Promise<Blob | null> {
  try {
    const decoded = await decode(file);
    try {
      const { width, height } = previewSize(decoded.width, decoded.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", PREVIEW_QUALITY),
      );
    } finally {
      decoded.close();
    }
  } catch {
    return null;
  }
}

/**
 * The original plus its preview: what a logo or avatar consumer needs. The preview upload
 * failing is not fatal (the original is what is kept); the caller then attaches the original
 * alone and the list shows the fallback until it is replaced.
 */
export async function uploadImageWithPreview({
  purpose,
  file,
  onProgress,
}: {
  purpose: Exclude<FilePurpose, "preview">;
  file: File;
  onProgress?: (fraction: number) => void;
}): Promise<UploadOutcome & { previewFileId?: string }> {
  const original = await uploadFile({
    purpose,
    file,
    name: file.name,
    ...(onProgress ? { onProgress } : {}),
  });
  if (!original.ok) return original;
  const preview = await makeJpegPreview(file);
  if (!preview) return original;
  const uploaded = await uploadFile({
    purpose: "preview",
    file: preview,
    name: `${file.name.replace(/\.[^.]+$/, "")}-preview.jpg`,
    previewOf: original.fileId,
  });
  return uploaded.ok ? { ...original, previewFileId: uploaded.fileId } : original;
}
