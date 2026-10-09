import { formatIST, type ISODate } from "@/core/time";

import { activeStages, carriedFromLabel, ITEM_RULES, plannedLine } from "./items";
import { ITEM_STATE_LABELS, type Item, type ItemStage, type ItemState, type Review } from "./types";

/**
 * What an item row and its sheet show (7.3; WORKFLOWS §5.3, kickoff 7 decisions 7, 12, 26; Q5 (b);
 * amendment D: the item's own stages, done = approved, the send-back / reopen), worked out on the
 * server so the client component only draws it. Pure, unit-tested.
 */

/** One of the item's own stages as the row and the sheet draw it. */
export type ItemStageView = { id: string; name: string; position: string; done: boolean };

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
  planned: { text: string; overdue: boolean } | null;
  /** "Carried from September" on a carried-in item. */
  carriedFrom: string | null;
  /** The item's own active stages, in order, each ticked or not (amendment D2). */
  stages: ItemStageView[];
  /**
   * The latest send-back or reopen while the item is open again: "Sent back by Prishit: the logo"
   * (the Owner's), "Reopened by Ravi: …" (the client's Admin's).
   */
  sentBack: { verb: "Sent back" | "Reopened"; by: string; reason: string } | null;
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

export function itemView(item: Item, context: ItemViewContext): ItemView {
  const name = (id: string | null) => (id ? (context.names[id] ?? "Someone") : "Someone");
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
    stages: activeStages(context.stages.filter((stage) => stage.itemId === item.id)).map(
      (stage) => ({
        id: stage.id,
        name: stage.name,
        position: stage.position,
        done: stage.doneAt !== null,
      }),
    ),
    sentBack:
      item.state === "open" && latest?.decision === "rejected"
        ? {
            verb: latest.reviewerId === context.ownerId ? "Sent back" : "Reopened",
            by: name(latest.reviewerId),
            reason: latest.reason ?? "",
          }
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
  planned: { text: string; overdue: boolean } | null;
  plannedDate: string | null;
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
): ItemRowView {
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
  };
}
