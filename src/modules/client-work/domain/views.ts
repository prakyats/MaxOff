import { formatIST, type ISODate } from "@/core/time";

import { carriedFromLabel, ITEM_RULES, plannedLine, tickedStages } from "./items";
import { ITEM_STATE_LABELS, type Item, type ItemState, type Review, type Tick } from "./types";

/**
 * What an item row and its sheet show (7.3; WORKFLOWS §5.3, kickoff 7 decisions 6, 7, 12, 26;
 * Q5 (b)), worked out on the server so the client component only draws it. Pure, unit-tested.
 */

export type ItemView = {
  id: string;
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
  /** The ticked stage ids. */
  ticked: string[];
  /** The latest rejection while the item is open again: "Sent back by Prishit: the logo". */
  sentBack: { by: string; reason: string } | null;
  /** A closed (cancelled) item's reason. */
  closedReason: string | null;
  /** "Done by Ravi, 8 Oct" / "Approved by Prishit, 9 Oct". */
  history: string[];
  /** What may change (the viewer's keys are applied by the screen). */
  rules: {
    ticks: boolean;
    markDone: boolean;
    notDone: boolean;
    decide: boolean;
    cancel: boolean;
    editAll: boolean;
  };
};

export type ItemViewContext = {
  today: ISODate;
  names: Readonly<Record<string, string>>;
  ticks: readonly Tick[];
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
  if (item.approvedAt) {
    history.push(`Approved by ${name(item.approvedBy)}, ${formatIST(item.approvedAt, WHEN)}`);
  }
  return {
    id: item.id,
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
    ticked: [...tickedStages(item.id, context.ticks)],
    sentBack:
      item.state === "open" && latest?.decision === "rejected"
        ? { by: name(latest.reviewerId), reason: latest.reason ?? "" }
        : null,
    closedReason: item.state === "cancelled" ? item.cancelledReason : null,
    history,
    rules: {
      ticks: ITEM_RULES.ticks(item.state),
      markDone: ITEM_RULES.markDone(item.state),
      notDone: ITEM_RULES.notDone(item.state),
      decide: ITEM_RULES.decide(item.state),
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
