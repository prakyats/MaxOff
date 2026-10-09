import "server-only";

import type { ActivityEntry } from "@/core/activity";
import { listActivity } from "@/core/activity/server";
import type { Json, Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import type { ISODate } from "@/core/time";

import type {
  Blueprint,
  CarryDecision,
  Cycle,
  Item,
  ItemStage,
  ItemState,
  Project,
  ProjectState,
  Recurrence,
  Review,
  Stage,
} from "../domain/types";
import type { ActivityKind } from "../domain/activity";

/**
 * The client-work repository (CLAUDE.md rule 3): every database call of the module. Reads run
 * under RLS as the signed-in member, so the Owner sees every client's projects, an Admin only their
 * clients', Crew nothing (PERMISSIONS §2). **Every write is a transition function** (7A: the seven
 * tables have no API write): permission, scope, state, change, audit and notifications in one
 * transaction (ADR-0006). A raised error carries the function's own code and message.
 */

/** PostgREST answers at most 1000 rows a call (`max_rows`): longer reads go page by page. */
export const PAGE = 1000;

export async function allPages<T>(
  page: (first: number, last: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let first = 0; ; first += PAGE) {
    const { data, error } = await page(first, first + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Ids per `in.(…)` filter: the address stays far below the proxy's limit (150 uuids ≈ 5.6 KB). */
export const IDS_PER_READ = 150;

export function chunks<T>(values: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += IDS_PER_READ) {
    out.push(values.slice(start, start + IDS_PER_READ));
  }
  return out;
}

/**
 * One read per chunk of ids, in parallel, the answers joined: every read keyed by a list of ids
 * goes through it, so no address outgrows the proxy however many ids a screen holds.
 */
export async function byChunks<T>(
  ids: readonly string[],
  read: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const parts = await Promise.all(chunks([...new Set(ids)]).map(read));
  return parts.flat();
}

export function asObject(value: Json | null | undefined): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const PROJECT_COLUMNS =
  "id, client_id, name, description, recurrence, state, delivery_date, custom_fields, template_id, created_by, created_at, cancelled_reason";

export function toProject(
  row: Pick<
    Tables<"projects">,
    | "id"
    | "client_id"
    | "name"
    | "description"
    | "recurrence"
    | "state"
    | "delivery_date"
    | "custom_fields"
    | "template_id"
    | "created_by"
    | "created_at"
    | "cancelled_reason"
  >,
): Project {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    description: row.description,
    recurrence: row.recurrence as Recurrence,
    state: row.state as ProjectState,
    deliveryDate: row.delivery_date,
    customFields: asObject(row.custom_fields),
    templateId: row.template_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    cancelledReason: row.cancelled_reason,
  };
}

export const CYCLE_COLUMNS = "id, project_id, period_start, period_end, label, state";

export function toCycle(
  row: Pick<
    Tables<"project_cycles">,
    "id" | "project_id" | "period_start" | "period_end" | "label" | "state"
  >,
): Cycle {
  return {
    id: row.id,
    projectId: row.project_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    label: row.label,
    state: row.state,
  };
}

export const ITEM_COLUMNS =
  "id, project_id, cycle_id, title, position, planned_date, notes, custom_fields, state, done_at, done_by, approved_at, approved_by, cancelled_reason, carry_decision, carried_from_item_id, origin_cycle_id, created_at";

type ItemColumns = Pick<
  Tables<"project_items">,
  | "id"
  | "project_id"
  | "cycle_id"
  | "title"
  | "position"
  | "planned_date"
  | "notes"
  | "custom_fields"
  | "state"
  | "done_at"
  | "done_by"
  | "approved_at"
  | "approved_by"
  | "cancelled_reason"
  | "carry_decision"
  | "carried_from_item_id"
  | "origin_cycle_id"
  | "created_at"
>;

export function toItem(row: ItemColumns): Item {
  return {
    id: row.id,
    projectId: row.project_id,
    cycleId: row.cycle_id,
    title: row.title,
    position: row.position,
    plannedDate: row.planned_date,
    notes: row.notes,
    customFields: asObject(row.custom_fields),
    state: row.state as ItemState,
    doneAt: row.done_at,
    doneBy: row.done_by,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    cancelledReason: row.cancelled_reason,
    carryDecision: row.carry_decision as CarryDecision | null,
    carriedFromItemId: row.carried_from_item_id,
    originCycleId: row.origin_cycle_id,
    createdAt: row.created_at,
  };
}

// Reads ---------------------------------------------------------------------------------------------

/** A client's projects, newest first (the Projects tab). */
export async function listClientProjects(clientId: string): Promise<Project[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(toProject);
}

/** The cycles of some projects (a project has one per period; a one-time project one). */
export async function listCycles(projectIds: readonly string[]): Promise<Cycle[]> {
  const supabase = await createServerSupabase();
  const rows = await byChunks(projectIds, (ids) =>
    allPages((first, last) =>
      supabase
        .from("project_cycles")
        .select(CYCLE_COLUMNS)
        .in("project_id", ids)
        .order("period_start", { ascending: true, nullsFirst: true })
        .order("id")
        .range(first, last),
    ),
  );
  return rows.map(toCycle);
}

/** The stages of some projects (every one: the screen keeps the active ones). */
export async function listStagesOf(projectIds: readonly string[]): Promise<Stage[]> {
  const supabase = await createServerSupabase();
  const rows = await byChunks(projectIds, (ids) =>
    allPages((first, last) =>
      supabase
        .from("project_stages")
        .select("id, project_id, name, position, archived_at")
        .in("project_id", ids)
        .order("id")
        .range(first, last),
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    position: row.position,
    archived: row.archived_at !== null,
  }));
}

/** One project (null: none, or not one the viewer may see). */
export async function getProject(projectId: string): Promise<Project | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data ? toProject(data) : null;
}

export async function listStages(projectId: string): Promise<Stage[]> {
  return listStagesOf([projectId]);
}

export async function listBlueprints(projectId: string): Promise<Blueprint[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("project_item_blueprints")
    .select("id, project_id, title, position, archived_at, stages")
    .eq("project_id", projectId);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    position: row.position,
    archived: row.archived_at !== null,
    stages: row.stages,
  }));
}

/** A cycle's items (at most 100 live, plus closed and carried ones). */
export async function listItems(cycleId: string): Promise<Item[]> {
  const supabase = await createServerSupabase();
  const rows = await allPages((first, last) =>
    supabase
      .from("project_items")
      .select(ITEM_COLUMNS)
      .eq("cycle_id", cycleId)
      .order("position")
      .range(first, last),
  );
  return rows.map(toItem);
}

/** Items by id (a carried item's origin, an item sheet opened from elsewhere). */
export async function listItemsById(itemIds: readonly string[]): Promise<Item[]> {
  const supabase = await createServerSupabase();
  const rows = await byChunks(itemIds, async (ids) => {
    const { data, error } = await supabase.from("project_items").select(ITEM_COLUMNS).in("id", ids);
    if (error) throw error;
    return data;
  });
  return rows.map(toItem);
}

export async function listCyclesById(cycleIds: readonly string[]): Promise<Cycle[]> {
  const supabase = await createServerSupabase();
  const rows = await byChunks(cycleIds, async (ids) => {
    const { data, error } = await supabase
      .from("project_cycles")
      .select(CYCLE_COLUMNS)
      .in("id", ids);
    if (error) throw error;
    return data;
  });
  return rows.map(toCycle);
}

/** A working project's current cycle: its client and its items' states (each progress line). */
export type CurrentCycle = Cycle & { clientId: string; states: ItemState[] };

/**
 * **The current cycles, in one request** (ARCHITECTURE §19, "one wave per screen"): the cycle of
 * each open or in-progress project whose period covers today (IST), or a one-time project's
 * cycle (no period), with its items' states embedded. Only what the progress lines use: never
 * every cycle a project ever had. `clientId` narrows it to one client (the Projects tab).
 */
export async function listCurrentCycles(
  today: ISODate,
  clientId?: string,
): Promise<CurrentCycle[]> {
  const supabase = await createServerSupabase();
  const rows = await allPages((first, last) => {
    let request = supabase
      .from("project_cycles")
      .select(
        `${CYCLE_COLUMNS}, project:projects!project_cycles_project_id_fkey!inner(client_id, state), items:project_items!project_items_cycle_id_fkey(state)`,
      )
      .in("project.state", ["open", "in_progress"])
      .or(`period_start.is.null,and(period_start.lte.${today},period_end.gte.${today})`);
    if (clientId) request = request.eq("project.client_id", clientId);
    return request.order("id").range(first, last);
  });
  return rows.map((row) => ({
    ...toCycle(row),
    clientId: row.project.client_id,
    states: row.items.map((item) => item.state as ItemState),
  }));
}

/** Some items' own stages (amendment D2), removed ones included (the screens keep the active). */
export async function listItemStages(itemIds: readonly string[]): Promise<ItemStage[]> {
  const supabase = await createServerSupabase();
  const rows = await byChunks(itemIds, (ids) =>
    allPages((first, last) =>
      supabase
        .from("project_item_stage_list")
        .select("id, item_id, project_id, name, position, archived_at, done_at, done_by")
        .in("item_id", ids)
        .order("item_id")
        .order("id")
        .range(first, last),
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    projectId: row.project_id,
    name: row.name,
    position: row.position,
    archived: row.archived_at !== null,
    doneAt: row.done_at,
    doneBy: row.done_by,
  }));
}

/** The approvals and rejections of some items, newest first. */
export async function listReviews(itemIds: readonly string[]): Promise<Review[]> {
  const supabase = await createServerSupabase();
  const parts = await byChunks(itemIds, (ids) =>
    allPages((first, last) =>
      supabase
        .from("item_reviews")
        .select("item_id, decision, reason, reviewer_id, at")
        .in("item_id", ids)
        .order("at", { ascending: false })
        .order("item_id")
        .range(first, last),
    ),
  );
  // Newest first across the chunks too.
  const rows = parts.sort((a, b) => b.at.localeCompare(a.at));
  return rows.map((row) => ({
    itemId: row.item_id,
    decision: row.decision === "approved" ? "approved" : "rejected",
    reason: row.reason,
    reviewerId: row.reviewer_id,
    at: row.at,
  }));
}

type ActivityRow = {
  id: number;
  actor_id: string | null;
  entity: string;
  entity_id: string;
  action: string;
  diff: Json;
  meta: Json;
  at: string;
};

function toEntry(row: ActivityRow): ActivityEntry {
  const diff = asObject(row.diff);
  return {
    id: row.id,
    actorId: row.actor_id,
    onBehalfOfId: null,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    old: asObject(diff.old as Json),
    new: asObject(diff.new as Json),
    meta: asObject(row.meta),
    at: row.at,
  };
}

/**
 * One page of a project's history, or one item's (`project_activity`, the owner's preview
 * feedback): newest first, `limit` entries before the cursor, under RLS. Entries the history
 * never shows are skipped by the function.
 */
export async function pageProjectActivity(args: {
  projectId: string;
  kind: ActivityKind;
  itemId: string | null;
  before: { at: string; id: number } | null;
  limit: number;
}): Promise<ActivityEntry[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_activity", {
    project_id: args.projectId,
    kind: args.kind,
    ...(args.itemId ? { item_id: args.itemId } : {}),
    ...(args.before ? { before_at: args.before.at, before_id: args.before.id } : {}),
    max_rows: args.limit,
  });
  if (error) throw error;
  return (data as ActivityRow[]).map(toEntry);
}

/** Each item's latest shown history entry (`item_last_changes`), for the sheet's "Last change". */
export async function listLastChanges(itemIds: readonly string[]): Promise<ActivityEntry[]> {
  const supabase = await createServerSupabase();
  const rows = await byChunks(itemIds, async (ids) => {
    const { data, error } = await supabase.rpc("item_last_changes", { item_ids: ids });
    if (error) throw error;
    return data as ActivityRow[];
  });
  return rows.map(toEntry);
}

/** Several projects' own entries (created, started, completed, cancelled, reopened, details). */
export async function listProjectsActivity(
  projectIds: readonly string[],
): Promise<ActivityEntry[]> {
  return listActivity([{ entity: "projects", ids: [...projectIds] }]);
}

// Transition functions (ADR-0006) --------------------------------------------------------------------

export type CreateProjectArgs = {
  clientId: string;
  name: string;
  recurrence: Recurrence;
  description: string | null;
  deliveryDate: string | null;
  stages: string[];
  items: string[];
  templateId: string | null;
  customFields: Record<string, unknown>;
};

export async function createProject(args: CreateProjectArgs): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_create", {
    client_id: args.clientId,
    name: args.name,
    recurrence: args.recurrence,
    ...(args.description ? { description: args.description } : {}),
    ...(args.deliveryDate ? { delivery_date: args.deliveryDate } : {}),
    stages: args.stages,
    items: args.items,
    ...(args.templateId ? { template_id: args.templateId } : {}),
    custom_fields: args.customFields as Json,
  });
  if (error) throw error;
  return data;
}

export async function updateProject(projectId: string, changes: Record<string, unknown>) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_update", {
    project_id: projectId,
    changes: changes as Json,
  });
  if (error) throw error;
  return data;
}

export async function completeProject(projectId: string): Promise<ProjectState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_complete", { project_id: projectId });
  if (error) throw error;
  return data as ProjectState;
}

export async function cancelProject(projectId: string, reason: string): Promise<ProjectState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_cancel", { project_id: projectId, reason });
  if (error) throw error;
  return data as ProjectState;
}

export async function reopenProject(projectId: string, reason: string): Promise<ProjectState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_reopen", { project_id: projectId, reason });
  if (error) throw error;
  return data as ProjectState;
}

export async function startNextCycle(projectId: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("cycle_start_next", { project_id: projectId });
  if (error) throw error;
  return data;
}

export async function addStage(projectId: string, name: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_stage_add", { project_id: projectId, name });
  if (error) throw error;
  return data;
}

export async function updateStage(stageId: string, changes: Record<string, unknown>) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("project_stage_update", {
    stage_id: stageId,
    changes: changes as Json,
  });
  if (error) throw error;
}

export async function archiveStage(stageId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("project_stage_archive", { stage_id: stageId });
  if (error) throw error;
}

export async function addBlueprint(projectId: string, title: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_blueprint_add", {
    project_id: projectId,
    title,
  });
  if (error) throw error;
  return data;
}

export async function updateBlueprint(blueprintId: string, changes: Record<string, unknown>) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("project_blueprint_update", {
    blueprint_id: blueprintId,
    changes: changes as Json,
  });
  if (error) throw error;
}

export async function archiveBlueprint(blueprintId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("project_blueprint_archive", { blueprint_id: blueprintId });
  if (error) throw error;
}

export async function addItem(args: {
  cycleId: string;
  title: string;
  plannedDate: string | null;
  notes: string | null;
}): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("item_add", {
    cycle_id: args.cycleId,
    title: args.title,
    ...(args.plannedDate ? { planned_date: args.plannedDate } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
  });
  if (error) throw error;
  return data;
}

export async function updateItem(itemId: string, changes: Record<string, unknown>) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("item_update", {
    item_id: itemId,
    changes: changes as Json,
  });
  if (error) throw error;
  return data;
}

export async function cancelItem(itemId: string, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("item_cancel", { item_id: itemId, reason });
  if (error) throw error;
}

export async function markItemDone(itemId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("item_mark_done", { item_id: itemId });
  if (error) throw error;
}

/** Send back (the Owner) or reopen (the client's Admin) a done item, with a reason (D3). */
export async function reopenItem(itemId: string, reason: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("item_reopen", { item_id: itemId, reason });
  if (error) throw error;
}

export async function addItemStage(itemId: string, name: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("item_stage_add", { item_id: itemId, name });
  if (error) throw error;
  return data;
}

export async function updateItemStage(stageId: string, changes: Record<string, unknown>) {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("item_stage_update", {
    stage_id: stageId,
    changes: changes as Json,
  });
  if (error) throw error;
}

export async function archiveItemStage(stageId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("item_stage_archive", { stage_id: stageId });
  if (error) throw error;
}

export async function tickItemStage(stageId: string, done: boolean): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("item_stage_tick", { stage_id: stageId, done });
  if (error) throw error;
}

/** A bulk call's answer, one result per id (7A mechanics (3)). */
export type BulkRow =
  | { id: string; ok: true; state: string }
  | { id: string; ok: false; code: string; message: string };

function bulkRows(data: Json): BulkRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((value): BulkRow[] => {
    const row = asObject(value as Json);
    if (typeof row.id !== "string") return [];
    return row.ok === true
      ? [{ id: row.id, ok: true as const, state: String(row.state ?? "") }]
      : [
          {
            id: row.id,
            ok: false as const,
            code: String(row.code ?? "UNKNOWN"),
            message: String(row.message ?? "This item could not be changed."),
          },
        ];
  });
}

export async function carryDecide(
  itemIds: readonly string[],
  decision: CarryDecision,
  reason: string | null,
): Promise<BulkRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("cycle_carry_decide", {
    item_ids: [...itemIds],
    decision,
    ...(reason ? { reason } : {}),
  });
  if (error) throw error;
  return bulkRows(data);
}
