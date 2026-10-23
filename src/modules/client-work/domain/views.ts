import { groupRows } from "@/core/lib/stage-groups";
import { formatIST, type ISODate } from "@/core/time";

import { activeStages, carriedFromLabel, ITEM_RULES, type PlannedLine, plannedLine } from "./items";
import { itemMeter } from "./progress";
import { ITEM_STATE_LABELS, type Item, type ItemStage, type ItemState, type Review } from "./types";

/**
 * What an item row and its sheet show (7.3; WORKFLOWS §5.3, kickoff 7 decisions 7, 12, 26; Q5 (b);
 * amendment D: the item's own stages, done = approved, the send-back / reopen), worked out on the
 * server so the client component only draws it. Pure, unit-tested.
 */

/** One of the item's own stages as the row and the sheet draw it, with its group (6b). */
export type ItemStageView = {
  id: string;
  name: string;
  position: string;
  groupLabel: string | null;
  groupPosition: string | null;
  done: boolean;
};

/**
 * One group of the item's stages as the screens draw it (6b): its heading (`label` null: the
 * untitled group, no heading) and its own "n/m".
 */
export type ItemStageGroupView = {
  label: string | null;
  groupPosition: string | null;
  stages: ItemStageView[];
  done: number;
};

/** The stages under their groups, in order, each group with its ticked count. */
export function stageGroupViews(stages: readonly ItemStageView[]): ItemStageGroupView[] {
  return groupRows(stages).map((group) => ({
    label: group.label,
    groupPosition: group.groupPosition,
    stages: group.rows,
    done: group.rows.filter((stage) => stage.done).length,
  }));
}

/** "Last change: marked Reel 1 done by Ravi, 8 Oct, 4:10 pm" (the owner's preview feedback). */
export type LastChange = { text: string; by: string; at: string };

export type ItemView = {
  id: string;
  projectId: string;
  title: string;
  notes: string | null;
  plannedDate: string | null;
  position: string;
  state: ItemState;
  stateLabel: string;
  /** "Overdue · 6 Oct", "Due today", "Planned 10 Oct". */
  planned: PlannedLine | null;
  /** "Carried from September" on a carried-in item. */
  carriedFrom: string | null;
  /** The item's own active stages, in order, each ticked or not (amendment D2). */
  stages: ItemStageView[];
  /** The same stages under their groups (6b); one untitled group for a list from before. */
  groups: ItemStageGroupView[];
  /**
   * The item's next stage to tick while it is open (6b.11 (3): outlined and emphasised; the ticked
   * ones before it neutral with a check, the later ones muted); null when none is left or it is
   * not open.
   */
  nextStageId: string | null;
  /**
   * The latest send-back or reopen while the item is open again (6b.11 (4)): "Sent back by
   * Prishit, 9 Oct: the logo" (the Owner's), "Reopened by Ravi, 9 Oct: …" (the client's Admin's).
   */
  sentBack: {
    verb: "Sent back" | "Reopened";
    by: string;
    reason: string;
    /** "9 Oct" (IST). */
    on: string;
    /** The whole note: "Reopened by Ravi, 9 Oct: the logo". */
    text: string;
  } | null;
  /** The item's latest history line, for the sheet. */
  lastChange: LastChange | null;
  /** A closed (cancelled) item's reason. */
  closedReason: string | null;
  /** "Done by Ravi, 8 Oct" (and, for an item approved apart before amendment D3, its approval). */
  history: string[];
  /** What may change (the viewer's keys are applied by the screen). */
  rules: {
    ticks: boolean;
    markDone: boolean;
    reopen: boolean;
    cancel: boolean;
    editAll: boolean;
  };
};

export type ItemViewContext = {
  today: ISODate;
  names: Readonly<Record<string, string>>;
  /** The Owner's member id: his send-back reads "Sent back", the Admin's "Reopened". */
  ownerId: string | null;
  /** The items' own stages (every item's; each view keeps its own active ones). */
  stages: readonly ItemStage[];
  /** Each item's latest history line, by item id. */
  lastChanges?: Readonly<Record<string, LastChange>>;
  /** Each item's reviews, newest first. */
  reviews: readonly Review[];
  /** Cycle labels by id (a carried-in item's origin). */
  cycleLabels: Readonly<Record<string, string | null>>;
  /** The label of the cycle the item is in. */
  cycleLabel: string | null;
};

const WHEN = "d MMM";

function sentBackNote(
  verb: "Sent back" | "Reopened",
  by: string,
  reason: string,
  on: string,
): NonNullable<ItemView["sentBack"]> {
  return { verb, by, reason, on, text: `${verb} by ${by}, ${on}${reason ? `: ${reason}` : ""}` };
}

export function itemView(item: Item, context: ItemViewContext): ItemView {
  const name = (id: string | null) => (id ? (context.names[id] ?? "Someone") : "Someone");
  const stages = activeStages(context.stages.filter((stage) => stage.itemId === item.id)).map(
    (stage) => ({
      id: stage.id,
      name: stage.name,
      position: stage.position,
      groupLabel: stage.groupLabel,
      groupPosition: stage.groupPosition,
      done: stage.doneAt !== null,
    }),
  );
  const latest = context.reviews.find((review) => review.itemId === item.id) ?? null;
  const history: string[] = [];
  if (item.doneAt) history.push(`Done by ${name(item.doneBy)}, ${formatIST(item.doneAt, WHEN)}`);
  if (item.approvedAt && item.approvedAt !== item.doneAt) {
    history.push(`Approved by ${name(item.approvedBy)}, ${formatIST(item.approvedAt, WHEN)}`);
  }
  return {
    id: item.id,
    projectId: item.projectId,
    title: item.title,
    notes: item.notes,
    plannedDate: item.plannedDate,
    position: item.position,
    state: item.state,
    stateLabel: ITEM_STATE_LABELS[item.state],
    planned: plannedLine(item, context.today),
    carriedFrom:
      item.carriedFromItemId !== null && item.originCycleId !== item.cycleId
        ? carriedFromLabel(context.cycleLabels[item.originCycleId] ?? null, context.cycleLabel)
        : null,
    stages,
    groups: stageGroupViews(stages),
    nextStageId: item.state === "open" ? (stages.find((stage) => !stage.done)?.id ?? null) : null,
    sentBack:
      item.state === "open" && latest?.decision === "rejected"
        ? sentBackNote(
            latest.reviewerId === context.ownerId ? "Sent back" : "Reopened",
            name(latest.reviewerId),
            latest.reason ?? "",
            formatIST(latest.at, WHEN),
          )
        : null,
    lastChange: context.lastChanges?.[item.id] ?? null,
    closedReason: item.state === "cancelled" ? item.cancelledReason : null,
    history,
    rules: {
      ticks: ITEM_RULES.ticks(item.state),
      markDone: ITEM_RULES.markDone(item.state),
      reopen: ITEM_RULES.reopen(item.state),
      cancel: ITEM_RULES.cancel(item.state),
      editAll: ITEM_RULES.editAll(item.state),
    },
  };
}

/** An item in a list that crosses projects and clients (the cross-client list, the carry screen). */
export type ItemRowView = {
  id: string;
  title: string;
  /** The project page, on the item's cycle. */
  href: string;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  adminId: string | null;
  cycleId: string;
  cycleLabel: string | null;
  state: ItemState;
  stateLabel: string;
  planned: PlannedLine | null;
  plannedDate: string | null;
  /** The deliverable's own stages as a miniature (6b.11 (5)); null when it has none. */
  meter: { done: number; next: number; total: number } | null;
};

export function itemRowView(
  row: Item & {
    projectName: string;
    clientId: string;
    clientName: string;
    adminId: string | null;
    cycleLabel: string | null;
  },
  today: ISODate,
  /** The deliverable's own stages (active ones, ticked or not), for its miniature. */
  stages: readonly { done: boolean }[] = [],
): ItemRowView {
  const meter = itemMeter({ state: row.state, stages });
  return {
    id: row.id,
    title: row.title,
    href: `/clients/${row.clientId}/projects/${row.projectId}?cycle=${row.cycleId}`,
    projectId: row.projectId,
    projectName: row.projectName,
    clientId: row.clientId,
    clientName: row.clientName,
    adminId: row.adminId,
    cycleId: row.cycleId,
    cycleLabel: row.cycleLabel,
    state: row.state,
    stateLabel: ITEM_STATE_LABELS[row.state],
    planned: plannedLine(row, today),
    plannedDate: row.plannedDate,
    meter: meter.total > 0 ? meter : null,
  };
}

/**
 * The project page's order (6b.11 (1)): the **open** deliverables first, the overdue ones at the
 * top, then by planned date (none last), then in the list's own order; done, closed and carried
 * ones apart, for the collapsed "Done and closed (N)" group at the end, in the list's order.
 * `items` arrive in the list's order (`sortItems`); the sort is stable.
 */
export function orderDeliverables<
  T extends Pick<ItemView, "state" | "plannedDate"> & { planned: { overdue: boolean } | null },
>(items: readonly T[]): { open: T[]; finished: T[] } {
  const open = items.filter((item) => item.state === "open");
  const finished = items.filter((item) => item.state !== "open");
  const rank = (item: T) => (item.planned?.overdue ? 0 : item.plannedDate !== null ? 1 : 2);
  open.sort(
    (a, b) => rank(a) - rank(b) || (a.plannedDate ?? "").localeCompare(b.plannedDate ?? ""),
  );
  return { open, finished };
}
