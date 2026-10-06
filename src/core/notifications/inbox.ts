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

/**
 * One entry of the Alerts list (5B decision 10, `notifications_inbox`): a notification, or a run
 * of consecutive ones about the same record on the same IST day, drawn as its newest row.
 */
export interface InboxRow {
  /** The newest row's id: what the entry opens (`/open?n=`) or reads. */
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** An app route the row opens (through `/open`); null when there is nothing to open. */
  link: string | null;
  createdAt: string;
  /** How many notifications the entry holds (1 for most). */
  runSize: number;
  /** Their kinds, sorted. */
  runKinds: string[];
  /** The ids still unread, newest first: the entry is unread while any is. */
  runUnread: string[];
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

/**
 * One page of the member's Alerts, newest first, with the number of entries for the pager. Same-
 * record runs are made by the database (`notifications_inbox`), so a page of 20 is 20 entries and
 * a run never splits across pages. `unreadOnly`: the "Unread" filter.
 */
export async function listInbox(
  page: number,
  unreadOnly = false,
): Promise<{ rows: InboxRow[]; total: number }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("notifications_inbox", {
    p_unread_only: unreadOnly,
    p_offset: (page - 1) * INBOX_PAGE_SIZE,
    p_limit: INBOX_PAGE_SIZE,
  });
  if (error) throw error;
  return {
    rows: data.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      // A function's columns are typed not-null; these two may be null.
      body: (row.body as string | null) ?? null,
      link: (row.link as string | null) ?? null,
      createdAt: row.created_at,
      runSize: row.run_size,
      runKinds: row.run_kinds,
      runUnread: row.run_unread,
    })),
    // Every row carries the total; a page past the end has none.
    total: data[0]?.total ?? 0,
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
 * A row holding a run about one record, opened (5B decision 10): that notification and every
 * unread one about the same record are read, as opening the record does (kickoff 5 decision 4),
 * so the row is not left unread behind a page that marks nothing. How many were marked, and the
 * link. Null when it is not theirs.
 */
export async function markRunRead(
  id: string,
): Promise<{ link: string | null; marked: number } | null> {
  const opened = await markOneRead(id);
  if (!opened) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("notifications")
    .select("entity, entity_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const rest =
    data?.entity && data.entity_id ? await rpcMarkRecordRead(data.entity, data.entity_id) : 0;
  return { link: opened.link, marked: (opened.marked ? 1 : 0) + rest };
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
