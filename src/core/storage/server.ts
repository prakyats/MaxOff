import "server-only";

import type { Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { createServiceSupabase } from "@/core/db/service";
import { AppError } from "@/core/errors";

import { createS3Adapter, type StorageAdapter } from "./adapter";
import { storageEnv } from "./env";
import { safeFileName } from "./limits";

/**
 * The files repository (CLAUDE.md rule 3: core/storage owns `files`) and the adapter singleton.
 * Reads run under RLS as the signed-in member: `app.file_visible()` decides which rows answer,
 * so a file nobody may see reads as "not found", never "forbidden".
 *
 * Creating a row and marking it ready are the two writes the API role cannot make (phase 3
 * review): `file_begin()` and `file_complete()` are service_role only, so they run on the service
 * client, and only from the storage actions after their checks (permission, type and size for the
 * purpose; the object's size from the bucket; the SVG rewrite). The uploader is named explicitly
 * and re-checked in SQL. Nothing else in this file uses the service client.
 */

export type FileStatus = "pending" | "ready" | "failed" | "deleted";

export type FileRecord = {
  id: string;
  storageKey: string;
  name: string;
  mime: string;
  sizeBytes: number;
  sha256: string | null;
  uploadedBy: string | null;
  status: FileStatus;
  previewOf: string | null;
  createdAt: string;
  archivedAt: string | null;
};

function isStatus(value: string): value is FileStatus {
  return value === "pending" || value === "ready" || value === "failed" || value === "deleted";
}

export function toFileRecord(row: Tables<"files">): FileRecord {
  if (!isStatus(row.status)) {
    throw new AppError("INTERNAL", undefined, {
      cause: new Error(`files row ${row.id} has status ${row.status}`),
    });
  }
  return {
    id: row.id,
    storageKey: row.storage_key,
    name: row.name,
    mime: row.mime,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    uploadedBy: row.uploaded_by,
    status: row.status,
    previewOf: row.preview_of,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

let adapter: StorageAdapter | null = null;

/** One adapter per server, built from the environment on first use. */
export function getStorageAdapter(): StorageAdapter {
  adapter ??= createS3Adapter(storageEnv());
  return adapter;
}

/**
 * A pending row for an upload the member is about to make, once the action has checked it. The
 * database builds the storage key (`<org>/<IST yyyy/mm>/<id>/<name>`).
 */
export async function createPendingFile(input: {
  uploaderId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  previewOf: string | null;
}): Promise<FileRecord> {
  const { data, error } = await createServiceSupabase()
    .rpc("file_begin", {
      file_id: crypto.randomUUID(),
      uploader: input.uploaderId,
      name: safeFileName(input.name),
      mime: input.mime,
      size_bytes: input.sizeBytes,
      ...(input.previewOf ? { preview_of: input.previewOf } : {}),
    })
    .single();
  if (error) throw error;
  return toFileRecord(data);
}

/** The row, when the caller may see it (`app.file_visible`); null otherwise. */
export async function getFile(fileId: string): Promise<FileRecord | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("files").select("*").eq("id", fileId).maybeSingle();
  if (error) throw error;
  return data ? toFileRecord(data) : null;
}

/** The newest ready preview of an original, when the caller may see the original. */
export async function getPreviewOf(fileId: string): Promise<FileRecord | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("preview_of", fileId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toFileRecord(data) : null;
}

/** Marks the uploader's pending row ready, once the action has confirmed the object. */
export async function completeFile(
  fileId: string,
  uploaderId: string,
  sizeBytes: number,
  sha256: string | null,
): Promise<void> {
  const { error } = await createServiceSupabase().rpc("file_complete", {
    file_id: fileId,
    uploader: uploaderId,
    size_bytes: sizeBytes,
    ...(sha256 ? { sha256 } : {}),
  });
  if (error) throw error;
}

export async function failFile(fileId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("file_fail", { file_id: fileId });
  if (error) throw error;
}
