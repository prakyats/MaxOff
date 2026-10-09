import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { addISTDays, type ISODate } from "@/core/time";

import type { ClientState, ItemRow, ItemState } from "../domain/types";

import { allPages, byChunks, ITEM_COLUMNS, toItem } from "./projects";

/**
 * The reads that cross projects and clients (7.3 / 7.4): the cross-client item list, Today's
 * Client work and Needs you counts, the carry screen, the calendar's
 * planned dates and the work report's item facts. All under RLS: the Owner reads every client's
 * items, an Admin only their clients', Crew none. Each list is read page by page (PostgREST's
 * 1000-row limit, 6A mechanics (1)); a count is a head request.
 */

const ROW_SELECT = `${ITEM_COLUMNS}, project:projects!project_items_project_id_fkey!inner(name, client_id, client:clients!projects_client_id_fkey!inner(name, admin_id, state)), cycle:project_cycles!project_items_cycle_id_fkey!inner(label, period_end)`;

type Embedded = {
  project: {
    name: string;
    client_id: string;
    client: { name: string; admin_id: string | null; state: ClientState };
  };
  cycle: { label: string | null; period_end: string | null };
};

function toRow(row: Parameters<typeof toItem>[0] & Embedded): ItemRow {
  return {
    ...toItem(row),
    projectName: row.project.name,
    clientId: row.project.client_id,
    clientName: row.project.client.name,
    adminId: row.project.client.admin_id,
    clientState: row.project.client.state,
    cycleLabel: row.cycle.label,
    cyclePeriodEnd: row.cycle.period_end,
  };
}

export type ItemQuery = {
  states: readonly ItemState[];
  /** Planned on or before this date (items without a date are left out). */
  plannedTo?: ISODate;
  /** Planned on or after this date. */
  plannedFrom?: ISODate;
  /** Only items of cycles whose period ended before this date. */
  cycleEndedBefore?: ISODate;
  clientId?: string;
  projectId?: string;
};

/** Items with their project, client and cycle, by the query, oldest planned date first. */
export async function listItemRows(query: ItemQuery): Promise<ItemRow[]> {
  const supabase = await createServerSupabase();
  const rows = await allPages((first, last) => {
    let request = supabase
      .from("project_items")
      .select(ROW_SELECT)
      .in("state", [...query.states]);
    if (query.plannedTo) request = request.lte("planned_date", query.plannedTo);
    if (query.plannedFrom) request = request.gte("planned_date", query.plannedFrom);
    if (query.cycleEndedBefore) request = request.lt("cycle.period_end", query.cycleEndedBefore);
    if (query.projectId) request = request.eq("project_id", query.projectId);
    if (query.clientId) request = request.eq("project.client_id", query.clientId);
    return request
      .order("planned_date", { ascending: true, nullsFirst: false })
      .order("id")
      .range(first, last);
  });
  return (rows as unknown as (Parameters<typeof toItem>[0] & Embedded)[]).map(toRow);
}

/** How many items match, with no rows read. */
async function countItems(query: ItemQuery): Promise<number> {
  const supabase = await createServerSupabase();
  const embed = query.cycleEndedBefore
    ? "id, cycle:project_cycles!project_items_cycle_id_fkey!inner(period_end)"
    : "id";
  let request = supabase
    .from("project_items")
    .select(embed, { count: "exact", head: true })
    .in("state", [...query.states]);
  if (query.plannedTo) request = request.lte("planned_date", query.plannedTo);
  if (query.cycleEndedBefore) request = request.lt("cycle.period_end", query.cycleEndedBefore);
  const { count, error } = await request;
  if (error) throw error;
  return count ?? 0;
}

/** Open items planned before today (IST): the Owner's Today count (amendment C E1). */
export function countOverdueItems(today: ISODate): Promise<number> {
  return countItems({ states: ["open"], plannedTo: addISTDays(today, -1) });
}

/** Open items of ended cycles (undecided or left pending): the carry decision (decision 11). */
export function countItemsToDecide(today: ISODate): Promise<number> {
  return countItems({ states: ["open"], cycleEndedBefore: today });
}

/**
 * Open items whose latest send-back is someone else's: "sent back" on the Admin's Needs you
 * (decision 19, amendment D3: the Owner's send-back of a done item), with the reason. The viewer's
 * own reopens are not news to them (never the actor). Only rejections are read (a done item is
 * locked, so an open item's latest review is always its send-back or reopen); the rows by chunks
 * of ids.
 */
export async function listSentBack(
  viewerId: string,
): Promise<(ItemRow & { reason: string | null; reviewerId: string; at: string })[]> {
  const supabase = await createServerSupabase();
  const reviews = await allPages((first, last) =>
    supabase
      .from("item_reviews")
      .select("item_id, reason, reviewer_id, at, item:project_items!inner(state)")
      .eq("decision", "rejected")
      .eq("item.state", "open")
      .order("at", { ascending: false })
      .order("item_id")
      .range(first, last),
  );
  const latest = new Map<string, (typeof reviews)[number]>();
  for (const review of reviews) if (!latest.has(review.item_id)) latest.set(review.item_id, review);
  const sentBack = [...latest.values()].filter((review) => review.reviewer_id !== viewerId);
  const data = await byChunks(
    sentBack.map((review) => review.item_id),
    async (ids) => {
      const { data: part, error } = await supabase
        .from("project_items")
        .select(ROW_SELECT)
        .in("id", ids);
      if (error) throw error;
      return part as unknown as (Parameters<typeof toItem>[0] & Embedded)[];
    },
  );
  const rows = new Map(data.map((row) => [row.id, toRow(row)]));
  return sentBack.flatMap((review) => {
    const row = rows.get(review.item_id);
    return row
      ? [{ ...row, reason: review.reason, reviewerId: review.reviewer_id, at: review.at }]
      : [];
  });
}

/**
 * The work report's item facts (7.4, PRODUCT §4.13) for the IST days `from` to `to`: every item
 * with a planned date in the range (On time), and the reviews in it.
 */
export async function listPlannedItems(from: ISODate, to: ISODate): Promise<ItemRow[]> {
  return listItemRows({
    states: ["open", "done", "approved", "cancelled", "carried"],
    plannedFrom: from,
    plannedTo: to,
  });
}
