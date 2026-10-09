/**
 * Client work (phase 7; PRODUCT §4.5, WORKFLOWS §5, DATA-MODEL §5): projects of a client, their
 * stages, item list and cycles, and the items in each cycle. Never an amount (ADR-0007: money is
 * the Owner's, phase 9). Plain types: the data layer maps the rows into them.
 */

export type Recurrence = "one_time" | "weekly" | "monthly";
export type ProjectState = "open" | "in_progress" | "completed" | "cancelled";
export type CycleState = "open" | "settled";
export type ItemState = "open" | "done" | "approved" | "cancelled" | "carried";
export type ClientState = "draft" | "active" | "paused" | "inactive";
export type CarryDecision = "carry_forward" | "close" | "leave_pending";

export const RECURRENCES: readonly Recurrence[] = ["monthly", "weekly", "one_time"];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  one_time: "One-time",
  weekly: "Weekly",
  monthly: "Monthly",
};

export const PROJECT_STATE_LABELS: Record<ProjectState, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * An item's word (kickoff 7 decision 18: a cancelled item reads "closed"). Since amendment D3 a done
 * item is approved in the same step, so `approved` reads "Done"; `done` is only an item from before
 * it.
 */
export const ITEM_STATE_LABELS: Record<ItemState, string> = {
  open: "Open",
  done: "Done",
  approved: "Done",
  cancelled: "Closed",
  carried: "Carried",
};

/** The status dot's key (`StatusBadge`): a closed item is `cancelled`, a carried one `carried`. */
export const ITEM_STATUS: Record<ItemState, string> = {
  open: "open",
  done: "done",
  approved: "approved",
  cancelled: "cancelled",
  carried: "carried",
};

export type Project = {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  recurrence: Recurrence;
  state: ProjectState;
  /** A one-time project's delivery date (amendment A); null for weekly and monthly ones. */
  deliveryDate: string | null;
  customFields: Record<string, unknown>;
  templateId: string | null;
  createdBy: string;
  createdAt: string;
  cancelledReason: string | null;
};

export type Cycle = {
  id: string;
  projectId: string;
  /** Null for a one-time project's single cycle. */
  periodStart: string | null;
  periodEnd: string | null;
  /** "October 2026", "5–11 Oct 2026"; null for a one-time project (decision 26). */
  label: string | null;
  state: CycleState;
  /** False while a cycle a carry made for a non-Active client waits for the item list (Q4 (a)). */
  itemListCopied: boolean;
};

export type Stage = {
  id: string;
  projectId: string;
  name: string;
  position: string;
  archived: boolean;
};

/** One line of a recurring project's item list (it feeds later cycles only, decision 9). */
export type Blueprint = {
  id: string;
  projectId: string;
  title: string;
  position: string;
  archived: boolean;
  /** The stages each item made from it starts with (amendment D2). */
  stages: string[];
};

export type Item = {
  id: string;
  projectId: string;
  cycleId: string;
  title: string;
  position: string;
  plannedDate: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  state: ItemState;
  doneAt: string | null;
  doneBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  cancelledReason: string | null;
  carryDecision: CarryDecision | null;
  carriedFromItemId: string | null;
  originCycleId: string;
  createdAt: string;
};

/**
 * One of an item's own stages (amendment D2): its name, place, whether it was removed (archived,
 * its tick kept) and its tick (`doneAt` null: not ticked, or unticked again).
 */
export type ItemStage = {
  id: string;
  itemId: string;
  projectId: string;
  name: string;
  position: string;
  archived: boolean;
  doneAt: string | null;
  doneBy: string | null;
};

export type Review = {
  itemId: string;
  decision: "approved" | "rejected";
  reason: string | null;
  reviewerId: string;
  at: string;
};

/** An item with where it lives, for the lists that cross projects and clients. */
export type ItemRow = Item & {
  projectName: string;
  clientId: string;
  clientName: string;
  /** The client's current Admin (null: the Owner runs it). */
  adminId: string | null;
  clientState: ClientState;
  cycleLabel: string | null;
  cyclePeriodEnd: string | null;
};

/** What the people a screen names are called. */
export type Names = Readonly<Record<string, string>>;
