import "server-only";

import { cache } from "react";

import { createServerSupabase } from "@/core/db/server";
import { systemClock } from "@/core/time";

import type { ServerUnread } from "./read-receipts";

/**
 * The member's own notifications (task 5.1, kickoff 5 decision 4; DATA-MODEL §9): the bell's
 * unread count, the history screen's pages and the read receipts. Read and written as the member:
 * RLS hands them their own rows only, and the API may set `read_at` alone (a read is view state,
 * not audited). Rows are written by `app.notify()` inside the transitions, never here.
 */

/** History rows per page. */
export const INBOX_PAGE_SIZE = 20;

export interface InboxRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** An app route the row opens (through `/open`); null when there is nothing to open. */
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

/**
 * How many of the member's notifications are unread: the bell's count (the bar's Alerts for
 * Staff, the title bar's and the top bar's bell for the Owner and Admins). One read per request:
 * the layout's nav counts and each title bar's bell share it. With the server's clock when it was
 * counted, so the device knows which of its own reads the count already holds.
 */
export const readUnread = cache(async (): Promise<ServerUnread> => {
  // Stamped before the count is asked: a read written before this moment is in it (the device's
  // read receipts, `read-receipts.ts`, compare the two).
  const countedAt = systemClock().getTime();
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return { count: count ?? 0, countedAt };
});

/** The bell's count alone (`readUnread()`'s). */
export async function countUnread(): Promise<number> {
  return (await readUnread()).count;
}

/** One page of the member's history, newest first, with the total for the pager. */
export async function listInbox(page: number): Promise<{ rows: InboxRow[]; total: number }> {
  const supabase = await createServerSupabase();
  const from = (page - 1) * INBOX_PAGE_SIZE;
  const { data, count, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, created_at, read_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + INBOX_PAGE_SIZE - 1);
  if (error) throw error;
  return {
    rows: data.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.link,
      createdAt: row.created_at,
      readAt: row.read_at,
    })),
    total: count ?? 0,
  };
}

/**
 * One of the member's own notifications, marked read (a tap on it) and its link, for the
 * deep-link entry. Null when it is not theirs or does not exist (RLS): nothing is marked.
 */
export async function markOneRead(
  id: string,
): Promise<{ link: string | null; marked: boolean } | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: systemClock().toISOString() })
    .eq("id", id)
    .is("read_at", null)
    .select("link")
    .maybeSingle();
  if (error) throw error;
  if (data) return { link: data.link, marked: true };
  // Already read: still theirs to open.
  const { data: row, error: readError } = await supabase
    .from("notifications")
    .select("link")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  return row ? { link: row.link, marked: false } : null;
}

/**
 * How many of the member's unread rows are about one record: what opening it takes off the bell
 * on the device at once (owner decision 2026-10-01), and whether there is anything to mark.
 */
export async function countUnreadAbout(entity: string, entityId: string): Promise<number> {
  const supabase = await createServerSupabase();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("entity", entity)
    .eq("entity_id", entityId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** Opening a record marks the member's unread rows about it read (`notifications_mark_read`). */
export async function rpcMarkRecordRead(entity: string, entityId: string): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("notifications_mark_read", {
    entity,
    entity_id: entityId,
  });
  if (error) throw error;
  return data;
}

/** "Mark all read" (`notifications_mark_all_read`): how many were marked. */
export async function rpcMarkAllRead(): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("notifications_mark_all_read");
  if (error) throw error;
  return data;
}
