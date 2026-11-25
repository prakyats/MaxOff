import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { toAppError } from "@/core/errors";

import { type UploadCard, type UploaderSheet, toUploadCard, toUploaderSheet } from "../domain/card";
import { fromBytea } from "./bytea";

/**
 * The member functions of the upload link (v4.5, DATA-MODEL §8a "Member reads" and "Member
 * transitions"; CLAUDE.md rule 3), with the caller's own client: every one checks
 * `uploads.manage` and the task's Admin (`app.upload_manager`) itself, and answers NOT_FOUND,
 * FORBIDDEN or UNAUTHENTICATED as `app.fail` does. Errors are thrown as they came, for `action()`.
 */

export async function readUploadCard(taskId: string): Promise<UploadCard> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("upload_card", { p_task_id: taskId });
  if (error) throw error;
  return toUploadCard(data);
}

/**
 * The card for the task page, streamed in its own Suspense boundary (WORKFLOWS §5B.3): `none` when
 * the caller isn't the task's Admin or the Owner (Crew, another Admin: the database refuses, and
 * the page draws no card), `failed` for anything else, so the card offers Retry instead of
 * failing the page.
 */
export type CardRead = { kind: "card"; card: UploadCard } | { kind: "none" } | { kind: "failed" };

export async function readUploadCardForPage(taskId: string): Promise<CardRead> {
  try {
    return { kind: "card", card: await readUploadCard(taskId) };
  } catch (error) {
    const code = toAppError(error).code;
    return code === "FORBIDDEN" || code === "NOT_FOUND" ? { kind: "none" } : { kind: "failed" };
  }
}

export async function readUploaderSheet(uploaderId: string): Promise<UploaderSheet> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("upload_uploader_files", {
    p_uploader_id: uploaderId,
  });
  if (error) throw error;
  return toUploaderSheet(data);
}

export async function rpcCreateLink(taskId: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("upload_link_create", { p_task_id: taskId });
  if (error) throw error;
  return data;
}

export async function rpcRenewLink(taskId: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("upload_link_renew", { p_task_id: taskId });
  if (error) throw error;
  return data;
}

export async function rpcStopLink(linkId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("upload_link_stop", { p_link_id: linkId });
  if (error) throw error;
}

export type LinkSecret = { linkId: string; salt: Uint8Array; keyVersion: number };

/** What the token is derived from (plan A3); `copy` writes the history row "copied". */
export async function rpcLinkSecret(linkId: string, copy: boolean): Promise<LinkSecret> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("upload_link_secret", {
    p_link_id: linkId,
    p_copy: copy,
  });
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error("upload_link_secret returned no row");
  return { linkId: row.link_id, salt: fromBytea(row.token_salt), keyVersion: row.key_version };
}

export async function rpcFilesReceived(input: {
  linkId: string;
  markDone: boolean;
  lateReason: string | null;
}): Promise<"marked_done" | "primary_told"> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("upload_files_received", {
    p_link_id: input.linkId,
    p_mark_done: input.markDone,
    // The generated types mark a function's arguments not-null; null is "no reason given".
    p_late_reason: input.lateReason as string,
  });
  if (error) throw error;
  return data === "marked_done" ? "marked_done" : "primary_told";
}

export async function rpcEraseNetwork(uploaderId: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("upload_uploader_erase_network", {
    p_uploader_id: uploaderId,
  });
  if (error) throw error;
  return data === true;
}
