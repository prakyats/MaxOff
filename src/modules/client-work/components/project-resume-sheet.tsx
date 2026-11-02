"use client";

import { useState } from "react";

import type { ResultError } from "@/core/errors";
import { cn } from "@/core/lib/utils";
import type { ISODate } from "@/core/time";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { DateInput } from "@/core/ui/primitives/date-time-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import { resumeProject } from "../actions/projects";
import type { CloseKind } from "../domain/close-kinds";
import {
  needsNewDate,
  type ResumeDecision,
  type ResumeEntry,
  resumeProblems,
  type ResumeRow,
  resumeWords,
} from "../domain/hold";
import { shortDate } from "../domain/items";
import { REASON_MAX } from "../domain/schemas";
import type { Recurrence } from "../domain/types";

import { CLEAR_KIND, CloseKindChoice } from "./close-kind-choice";

/** The three choices of an ended month, in the sample's words (owner 2026-10-29). */
const CHOICES: { value: ResumeDecision; label: string }[] = [
  { value: "carry_forward", label: "Carry forward" },
  { value: "close", label: "Close" },
  { value: "leave_pending", label: "Leave" },
];

type Draft = {
  date: string;
  decision: ResumeDecision | null;
  reason: string;
  closeKind: CloseKind | null;
};

const EMPTY: Draft = { date: "", decision: null, reason: "", closeKind: null };

/**
 * Resume a project (v1.9 W8; WORKFLOWS §5.5; the approved sample §2): the resume list
 * (`project_resume_list`) as one form filled in one go. Each deliverable whose planned date passed
 * takes a new date; each of an ended month takes **Carry forward**, **Close** (with its reason and
 * the W1 close kind) or **Leave** pending (a new date too when its date passed); a one-time project
 * may move its delivery date. The sheet checks the database's own rules first (`resumeProblems`)
 * and sends one `project_resume` call: one transaction, so a refusal changes nothing and says why
 * in plain words. A layer: back, Esc and "Not yet" close it (§14.2 a); a bottom sheet on a phone.
 * Loaded after the page, on the first tap (ARCHITECTURE §19).
 */
export function ProjectResumeSheet({
  open,
  onOpenChange,
  projectId,
  projectName,
  rows,
  today,
  recurrence,
  deliveryDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  rows: readonly ResumeRow[];
  today: ISODate;
  recurrence: Recurrence;
  /** A one-time project's delivery date (it may move with the resume); null otherwise. */
  deliveryDate: ISODate | null;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [delivery, setDelivery] = useState("");
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<ResultError | null>(null);
  const oneTime = recurrence === "one_time";
  const draftOf = (itemId: string) => drafts[itemId] ?? EMPTY;
  const change = (itemId: string, next: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? EMPTY), ...next } }));
    setProblems((current) => {
      if (!current[itemId]) return current;
      const rest = { ...current };
      delete rest[itemId];
      return rest;
    });
  };

  function entries(): ResumeEntry[] {
    return rows.map((row) => {
      const draft = draftOf(row.itemId);
      const closing = draft.decision === "close";
      return {
        itemId: row.itemId,
        plannedDate: closing || draft.date === "" ? null : (draft.date as ISODate),
        decision: row.monthEnded ? draft.decision : null,
        reason: closing ? draft.reason : null,
        closeKind: closing ? draft.closeKind : null,
      };
    });
  }

  function check(): boolean {
    const found = resumeProblems(rows, entries(), today);
    const byItem: Record<string, string[]> = {};
    for (const problem of found) {
      const key = problem.itemId ?? "";
      byItem[key] = [...(byItem[key] ?? []), problem.message];
    }
    // The W1 rule: a Close says which kind (the database takes none, as before W1; the sheet asks).
    for (const entry of entries()) {
      if (entry.decision === "close" && !entry.closeKind) {
        byItem[entry.itemId] = [...(byItem[entry.itemId] ?? []), "Choose why it is closed."];
      }
    }
    if (delivery !== "" && delivery < today) {
      byItem.delivery = ["Choose a delivery date from today on."];
    }
    setProblems(byItem);
    return Object.keys(byItem).length === 0;
  }

  const action = useAction(
    async () => {
      if (!check()) return;
      const result = await resumeProject({
        projectId,
        items: entries().map((entry) => ({
          itemId: entry.itemId,
          plannedDate: entry.plannedDate ?? null,
          decision: entry.decision ?? null,
          reason: entry.reason ?? null,
          closeKind: entry.closeKind ?? null,
        })),
        newDeliveryDate: oneTime && delivery !== "" ? delivery : null,
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      toastResult(result, { success: `${projectName} resumed` });
      setDrafts({});
      setDelivery("");
      onOpenChange(false);
    },
    { resetKey: open },
  );
  const { pending } = action;

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setProblems({});
      setFormError(null);
    }
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!check()) return;
    action.run();
  }

  const dated = rows.filter((row) => !row.monthEnded).length;
  const choosing = rows.length - dated;
  const summary = formError ? describeError(formError) : null;
  const invalid = Object.keys(problems).length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-slot="project-resume-sheet" className="md:max-w-lg">
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="break-words">Resume &ldquo;{projectName}&rdquo;</DialogTitle>
            <DialogDescription>{resumeWords(dated, choosing)}</DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : invalid > 0 ? (
            <ErrorText slot="form-alert">
              {invalid === 1
                ? "One deliverable still needs an answer."
                : `${invalid} deliverables still need an answer.`}
            </ErrorText>
          ) : null}
          {rows.length > 0 ? (
            <ul
              data-slot="resume-rows"
              className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
            >
              {rows.map((row) => (
                <ResumeRowField
                  key={row.itemId}
                  row={row}
                  draft={draftOf(row.itemId)}
                  today={today}
                  recurrence={recurrence}
                  problems={problems[row.itemId] ?? []}
                  onChange={(next) => change(row.itemId, next)}
                />
              ))}
            </ul>
          ) : null}
          {oneTime ? (
            <FormField
              label="New delivery date (optional)"
              hint={
                deliveryDate
                  ? `It is ${shortDate(deliveryDate)}. Leave it empty to keep it.`
                  : "Leave it empty to keep the project without one."
              }
              error={problems.delivery}
            >
              {(control) => (
                <DateInput
                  {...control}
                  name="deliveryDate"
                  min={today}
                  value={delivery}
                  onChange={(event) => {
                    setDelivery(event.target.value);
                    setProblems((current) => {
                      const rest = { ...current };
                      delete rest.delivery;
                      return rest;
                    });
                  }}
                />
              )}
            </FormField>
          ) : null}
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(false)}
              disabled={pending}
              data-dismiss=""
            >
              Not yet
            </Button>
            <Button variant="primary" type="submit" pending={pending} pendingLabel="Resuming…">
              Resume project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResumeRowField({
  row,
  draft,
  today,
  recurrence,
  problems,
  onChange,
}: {
  row: ResumeRow;
  draft: Draft;
  today: ISODate;
  recurrence: Recurrence;
  problems: readonly string[];
  onChange: (next: Partial<Draft>) => void;
}) {
  const closing = draft.decision === "close";
  const dateNeeded = needsNewDate(row, draft.decision, today);
  // A carried deliverable may take a date in its new month; a running one must.
  const dateShown = !row.monthEnded || (draft.decision !== null && !closing);
  const was = row.plannedDate ? `was ${shortDate(row.plannedDate)}` : "no planned date";
  const choices = CHOICES.filter(
    (choice) => choice.value !== "carry_forward" || row.carryForwardAllowed,
  );
  return (
    <li
      data-slot="resume-row"
      data-item={row.itemId}
      data-kind={row.monthEnded ? "choice" : "date"}
      className="flex min-w-0 flex-col gap-2 px-3 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-sm break-words">
          <span className="font-medium">{row.title}</span>
          <span className="text-muted-foreground block text-xs">
            {row.monthEnded ? `${row.cycleLabel ?? "Its period"}, ended · ${was}` : was}
            {row.leftPending ? " · left pending" : ""}
          </span>
        </span>
      </div>
      {row.monthEnded ? (
        <div
          role="radiogroup"
          aria-label={`What happens to ${row.title}`}
          className="bg-muted flex min-w-0 gap-1 rounded-lg p-1"
          data-slot="resume-choice"
        >
          {choices.map((choice) => {
            const on = draft.decision === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={on}
                data-choice={choice.value}
                onClick={() =>
                  onChange({
                    decision: choice.value,
                    ...(choice.value === "close" ? { date: "" } : {}),
                  })
                }
                className={cn(
                  "pressable text-muted-foreground focus-visible:ring-ring flex min-h-11 flex-1 items-center justify-center rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-2",
                  on && "bg-background text-foreground shadow-sm",
                )}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {dateShown ? (
        <FormField
          label={
            dateNeeded
              ? "New date"
              : draft.decision === "carry_forward"
                ? "Date in its new month (optional)"
                : "New date (optional)"
          }
        >
          {(control) => (
            <DateInput
              {...control}
              name={`date-${row.itemId}`}
              min={today}
              value={draft.date}
              onChange={(event) => onChange({ date: event.target.value })}
            />
          )}
        </FormField>
      ) : null}
      {closing ? (
        <>
          <CloseKindChoice
            recurrence={recurrence}
            name={`kind-${row.itemId}`}
            value={draft.closeKind ?? CLEAR_KIND}
            onChange={(value) => onChange({ closeKind: value === CLEAR_KIND ? null : value })}
          />
          <FormField label="Why close it">
            {(control) => (
              <Textarea
                {...control}
                name={`reason-${row.itemId}`}
                rows={2}
                maxLength={REASON_MAX}
                value={draft.reason}
                onChange={(event) => onChange({ reason: event.target.value })}
              />
            )}
          </FormField>
        </>
      ) : null}
      {problems.length > 0 ? <ErrorText>{problems[0]}</ErrorText> : null}
    </li>
  );
}
