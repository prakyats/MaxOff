import "server-only";

import type { Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { AppError } from "@/core/errors";
import { systemClock } from "@/core/time";

import { createS3Adapter, type StorageAdapter } from "./adapter";
import { storageEnv } from "./env";
import { storageKeyFor } from "./keys";
import { safeFileName } from "./limits";

export { storageKeyFor } from "./keys";

/**
 * The files repository (CLAUDE.md rule 3: core/storage owns `files`) and the adapter singleton.
 * Reads run under RLS as the signed-in member: `app.file_visible()` decides which rows answer,
 * so a file nobody may see reads as "not found", never "forbidden".
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

async function currentOrgId(): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("organizations").select("id").limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("UNAUTHENTICATED");
  return data.id;
}

/** A pending row for an upload the caller is about to make (RLS: their own). */
export async function createPendingFile(input: {
  name: string;
  mime: string;
  sizeBytes: number;
  previewOf: string | null;
}): Promise<FileRecord> {
  const supabase = await createServerSupabase();
  const orgId = await currentOrgId();
  const id = crypto.randomUUID();
  const { data, error } = await supabase
    .from("files")
    .insert({
      id,
      org_id: orgId,
      storage_key: storageKeyFor(orgId, id, input.name, systemClock()),
      name: safeFileName(input.name),
      mime: input.mime,
      size_bytes: input.sizeBytes,
      preview_of: input.previewOf,
    })
    .select("*")
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

export async function completeFile(
  fileId: string,
  sizeBytes: number,
  sha256: string | null,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("file_complete", {
    file_id: fileId,
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
