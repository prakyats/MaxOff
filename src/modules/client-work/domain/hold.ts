import type { ISODate } from "@/core/time";

import { isCloseKind, type CloseKind } from "./close-kinds";
import { shortDate } from "./items";
import type { Recurrence } from "./types";

/**
 * On hold, for projects (v1.9 W7; WORKFLOWS §5.5, ADR-0016). A held project keeps its state; its
 * deliverables read On hold, and the resume settles in one go every deliverable whose planned date
 * passed (a new date) and every open deliverable of an ended month (carry forward, close or leave
 * pending). Pure, so the resume sheet's rules are unit-tested; `project_resume` decides again in
 * one transaction and refuses a resume that leaves one out (the same rules, the same order).
 */

export const PROJECT_HOLD_REASON_MAX = 1000;

export type ResumeDecision = "carry_forward" | "close" | "leave_pending";

export const RESUME_DECISIONS: readonly ResumeDecision[] = [
  "carry_forward",
  "close",
  "leave_pending",
];

/** One row of `project_resume_list()`: a deliverable the resume must settle. */
export type ResumeRow = {
  itemId: string;
  title: string;
  cycleLabel: string | null;
  plannedDate: ISODate | null;
  /** Its month (or week) has ended: a choice is required. */
  monthEnded: boolean;
  /** Planned before today in a running (or one-time) cycle: a new date is required. */
  needsDate: boolean;
  /** Left pending before the hold: listed again, still needing a choice. */
  leftPending: boolean;
  /** False on an Inactive client: only Close or Leave pending. */
  carryForwardAllowed: boolean;
};

/** What the sheet sends for one deliverable. */
export type ResumeEntry = {
  itemId: string;
  plannedDate?: ISODate | null;
  decision?: ResumeDecision | null;
  reason?: string | null;
  closeKind?: CloseKind | null;
};

export type ResumeProblem = { itemId: string | null; message: string };

export function isProjectOnHold(project: { heldAt: string | null }): boolean {
  return project.heldAt !== null;
}

/** "On hold · 3 deliverables" (the reports' line and the Clients list), or null at zero. */
export function onHoldDeliverablesLine(count: number): string | null {
  if (count <= 0) return null;
  return `On hold · ${count} ${count === 1 ? "deliverable" : "deliverables"}`;
}

/** Whether the resume asks this deliverable for a new date, given the choice made for it. */
export function needsNewDate(
  row: Pick<ResumeRow, "monthEnded" | "needsDate" | "plannedDate">,
  decision: ResumeDecision | null | undefined,
  today: ISODate,
): boolean {
  if (!row.monthEnded) return row.needsDate;
  return decision === "leave_pending" && row.plannedDate !== null && row.plannedDate < today;
}

/** A one-time project's delivery date, and the new one the resume sheet holds (null: none given). */
export type ResumeDelivery = {
  recurrence: Recurrence;
  deliveryDate: ISODate | null;
  newDeliveryDate: ISODate | null;
};

/**
 * Whether the resume must move the delivery date (owner 2026-11-03, W7 Q5): a one-time project whose
 * delivery date is before today. Otherwise a new one is optional (or, recurring, there is none).
 */
export function deliveryDateRequired(
  delivery: Pick<ResumeDelivery, "recurrence" | "deliveryDate">,
  today: ISODate,
): boolean {
  return (
    delivery.recurrence === "one_time" &&
    delivery.deliveryDate !== null &&
    delivery.deliveryDate < today
  );
}

/**
 * Every reason the resume would be refused, in the database's order (`project_resume`): an entry
 * for a deliverable not listed, twice, or with an unknown choice; then each listed deliverable left
 * without its choice or its new date, a date before today, a closed one with a date or no reason,
 * a choice on a running month's deliverable; then the delivery date (`itemId` null): a passed one
 * left as it is, or a new one before today. Empty: the resume may be sent.
 */
export function resumeProblems(
  rows: readonly ResumeRow[],
  entries: readonly ResumeEntry[],
  today: ISODate,
  delivery?: ResumeDelivery,
): ResumeProblem[] {
  const problems: ResumeProblem[] = [];
  const listed = new Set(rows.map((row) => row.itemId));
  const byId = new Map<string, ResumeEntry>();
  for (const entry of entries) {
    if (byId.has(entry.itemId)) {
      problems.push({ itemId: entry.itemId, message: "A deliverable is listed twice." });
    }
    byId.set(entry.itemId, entry);
    if (entry.decision && !RESUME_DECISIONS.includes(entry.decision)) {
      problems.push({
        itemId: entry.itemId,
        message: "Choose carry forward, close or leave pending.",
      });
    }
    if (!listed.has(entry.itemId)) {
      problems.push({
        itemId: entry.itemId,
        message: "Only the deliverables listed for the resume take a new date or a choice.",
      });
    }
  }
  for (const row of rows) {
    const entry = byId.get(row.itemId);
    const decision = entry?.decision ?? null;
    const date = entry?.plannedDate ?? null;
    const problem = (message: string) => problems.push({ itemId: row.itemId, message });
    if (date !== null && date < today) {
      problem(`${row.title}: choose a date from today on.`);
      continue;
    }
    if (row.monthEnded) {
      if (decision === null) {
        problem(`${row.title}: choose carry forward, close or leave pending.`);
      } else if (decision === "carry_forward" && !row.carryForwardAllowed) {
        problem(`${row.title}: the client is closed, so close it or leave it pending.`);
      } else if (decision === "close") {
        if (date !== null) problem(`${row.title}: a closed deliverable takes no new date.`);
        if (!entry?.reason?.trim()) problem(`Say why ${row.title} is closed.`);
        if (entry?.closeKind != null && !isCloseKind(entry.closeKind)) {
          problem(`${row.title}: choose why it is closed.`);
        }
      } else if (needsNewDate(row, decision, today) && date === null) {
        problem(`${row.title}: give it a new date.`);
      }
    } else {
      if (decision !== null)
        problem(`${row.title}: its period has not ended, so it takes a new date only.`);
      if (row.needsDate && date === null) problem(`${row.title}: give it a new date.`);
    }
  }
  if (delivery) {
    const { deliveryDate, newDeliveryDate } = delivery;
    if (
      newDeliveryDate === null &&
      deliveryDate !== null &&
      deliveryDateRequired(delivery, today)
    ) {
      problems.push({
        itemId: null,
        message: `The delivery date (${shortDate(deliveryDate)}) has passed: choose a new one from today on.`,
      });
    } else if (newDeliveryDate !== null && newDeliveryDate < today) {
      problems.push({ itemId: null, message: "Choose a delivery date from today on." });
    }
  }
  return problems;
}

/** The `items` argument of `project_resume`, in the database's words. */
export function resumeItemsPayload(entries: readonly ResumeEntry[]): Record<string, unknown>[] {
  return entries.map((entry) => ({
    item_id: entry.itemId,
    ...(entry.plannedDate ? { planned_date: entry.plannedDate } : {}),
    ...(entry.decision ? { decision: entry.decision } : {}),
    ...(entry.reason?.trim() ? { reason: entry.reason.trim() } : {}),
    ...(entry.closeKind ? { close_kind: entry.closeKind } : {}),
  }));
}

/**
 * A cross-client list without the deliverables of held projects, and those apart (v1.9 W8;
 * ADR-0016): held work is never overdue, never in Needs you or Today's Client work, never on the
 * carry screen (its resume settles it). Order is kept.
 */
export function splitHeldItems<T extends { projectHeldAt: string | null }>(
  rows: readonly T[],
): { active: T[]; held: T[] } {
  const active: T[] = [];
  const held: T[] = [];
  for (const row of rows) (row.projectHeldAt === null ? active : held).push(row);
  return { active, held };
}

/**
 * The resume sheet's lede, in the sample's words (§2): "3 deliverables passed their planned date
 * while on hold. Give each a new date.", and the ended months' choice.
 */
export function resumeWords(dated: number, choosing: number, recurrence: Recurrence): string {
  const unit = periodUnit(recurrence);
  const parts: string[] = [];
  if (dated > 0) {
    parts.push(
      dated === 1
        ? "1 deliverable passed its planned date while on hold. Give it a new date."
        : `${dated} deliverables passed their planned date while on hold. Give each a new date.`,
    );
  }
  if (choosing > 0) {
    parts.push(
      choosing === 1
        ? `1 is from a ${unit} that has ended: carry it forward, close it or leave it pending.`
        : `${choosing} are from a ${unit} that has ended: carry each forward, close it or leave it pending.`,
    );
  }
  return parts.length > 0
    ? parts.join(" ")
    : "Nothing passed its date while it was on hold, so it carries on as it was.";
}

/**
 * The project's period in words: "week" for a weekly project, "month" otherwise (a one-time
 * project has no period, and its rows never end one), as `closeKindLabel` words it.
 */
export function periodUnit(recurrence: Recurrence): "week" | "month" {
  return recurrence === "weekly" ? "week" : "month";
}
