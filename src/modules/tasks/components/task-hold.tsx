"use client";

import { PauseIcon } from "lucide-react";
import dynamic from "next/dynamic";

import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { resumeTask } from "../actions/tasks";

import { useTaskView } from "./task-view";

/** The new-deadline sheet's code loads on the first tap that needs it (ARCHITECTURE §19). */
const TaskResumeDialog = dynamic(
  () => import("./task-resume-dialog").then((module) => module.TaskResumeDialog),
  { ssr: false },
);

/** What a resume needs to know: the deadline, and whether it has passed (then a new one). */
export type ResumeFacts = {
  taskId: string;
  title: string;
  dueAt: string;
  /** "Mon 26 Oct, 6:00 pm". */
  dueLabel: string;
  /** The deadline has passed (`resumeNeedsDeadline`, at render): the sheet asks for a new one. */
  needsDeadline: boolean;
};

/**
 * Resume, from the hold line or from ⋯ (v1.9 W8; the sample §1): with the deadline still ahead it
 * resumes in one tap; once it has passed it opens the new-deadline sheet (the page's one, held in
 * the task view's state so ⋯ and the hold line share it). `task_resume` decides again, and if the
 * deadline passed in the meantime its refusal opens the sheet.
 */
export function useResumeTask(facts: ResumeFacts) {
  const { setDialog } = useTaskView();
  const action = useAction(async () => {
    const result = await resumeTask({ taskId: facts.taskId, newDueAt: null });
    if (!result.ok && result.error.code === "VALIDATION") {
      setDialog("resume");
      return;
    }
    toastResult(result, { success: "Task resumed" });
  });
  return {
    action,
    start: () => (facts.needsDeadline ? setDialog("resume") : action.run()),
  };
}

/**
 * The task page's hold line (v1.9 W8; the approved sample §1): amber, where "Nothing needed from
 * you now" stands while the task is on hold. "On hold since 24 Oct · Prishit: "Client hasn't sent
 * the footage"", and **Resume**, its one button, for whoever may (the creator, the Owner). Those
 * on the task read why Start, Done and the ticks wait. Holds the new-deadline sheet.
 */
export function TaskHoldLine({
  title,
  reason,
  note,
  facts,
  canResume,
  solid,
}: {
  /** "On hold since 24 Oct". */
  title: string;
  /** "Prishit: "Client hasn't sent the footage"" (the name on a laptop only, as the sample). */
  reason: { by: string | null; text: string } | null;
  /** Why the work controls wait, for those on the task; null for anyone else. */
  note: string | null;
  facts: ResumeFacts;
  canResume: boolean;
  /** The layer's one solid commit (ADR-0015): false while a next step holds it. */
  solid: boolean;
}) {
  const { dialog, setDialog } = useTaskView();
  const resume = useResumeTask(facts);
  return (
    <div
      role="status"
      data-slot="task-hold-line"
      className="border-border bg-attention-soft flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm md:flex-row md:items-center md:gap-3 md:py-2"
    >
      <p className="flex min-w-0 flex-1 items-start gap-2 break-words">
        <PauseIcon aria-hidden className="text-attention mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">
          <span className="text-attention font-semibold" data-slot="task-hold-since">
            {title}
          </span>
          {reason ? (
            <>
              <span className="max-md:hidden"> · </span>
              <span className="block md:inline" data-slot="task-hold-reason">
                {reason.by ? <span className="max-md:hidden">{reason.by}: </span> : null}
                {reason.text}
              </span>
            </>
          ) : null}
          {note ? (
            <span className="text-muted-foreground block text-xs" data-slot="task-hold-note">
              {note}
            </span>
          ) : null}
        </span>
      </p>
      {canResume ? (
        <div className="flex min-w-0 flex-col gap-1 md:shrink-0 md:items-end">
          <Button
            type="button"
            variant={solid ? "primary" : "secondary"}
            commits
            className={cn("min-h-11 w-full md:min-h-8 md:w-auto")}
            pending={resume.action.pending}
            pendingLabel="Resuming…"
            data-slot="task-resume"
            onClick={resume.start}
          >
            Resume
          </Button>
          <ActionStatus action={resume.action} />
        </div>
      ) : null}
      {canResume ? (
        <TaskResumeDialog
          open={dialog === "resume"}
          onOpenChange={(open) => setDialog(open ? "resume" : null)}
          taskId={facts.taskId}
          title={facts.title}
          dueAt={facts.dueAt}
          dueLabel={facts.dueLabel}
        />
      ) : null}
    </div>
  );
}
