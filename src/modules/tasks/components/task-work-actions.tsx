"use client";

import { CheckIcon, Loader2Icon, PlayIcon } from "lucide-react";
import { useState, useTransition } from "react";

import type { ResultError } from "@/core/errors/result";
import { systemClock } from "@/core/time";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { Button } from "@/core/ui/primitives/button";
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

import {
  acknowledgeTask,
  reviewTask,
  setTaskApprover,
  startTask,
  submitDone,
} from "../actions/tasks";
import { NOTE_MAX, REASON_MAX } from "../domain/limits";
import type { ActingFor, TaskActions } from "../domain/task";

type WorkActions = Pick<TaskActions, "note" | "start" | "done" | "review" | "takeOver">;

/** 44px at least, and a long name ("Mark done for Asha Kumar") wraps instead of overflowing. */
const ACTION = "h-auto min-h-11 py-2 text-center whitespace-normal";

/**
 * The task's next action, on its first screen (4.4, PRODUCT §2 "First glance"): Task Noted (and
 * "Noted for Asha" for a freelancer's coordinator, ADR-0013), Start, Mark done, the review step
 * and the Owner's way past a waiting Admin. Only what the viewer may do now is shown; the
 * database decides again. The action colour rule: Task Noted is the screen's one solid red
 * commit; Mark done and Approve open a form or a confirmation (neutral solid), Request changes is
 * a red outline until its reason is sent.
 */
export function TaskWorkActions({
  taskId,
  dueAt,
  actions,
  names,
  approverName,
  primaryName,
}: {
  taskId: string;
  dueAt: string;
  actions: WorkActions;
  names: Record<string, string>;
  approverName: string | null;
  primaryName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"done" | "approve" | "reject" | "takeOver" | null>(null);

  const forName = (acting: ActingFor) =>
    acting.onBehalfOf ? (names[acting.onBehalfOf] ?? "them") : null;

  function run(key: string, work: () => Promise<boolean>) {
    setBusy(key);
    startTransition(async () => {
      await work();
      setBusy(null);
    });
  }

  const nothing =
    actions.note.length === 0 &&
    !actions.start &&
    !actions.done &&
    !actions.review &&
    !actions.takeOver;
  if (nothing) return null;

  return (
    <div data-slot="task-work-actions" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {actions.note.map((acting, index) => {
        const who = forName(acting);
        const key = `note:${acting.onBehalfOf ?? "self"}`;
        return (
          <Button
            key={key}
            // The first Task Noted is the screen's commit; a second one (for a freelancer) is not.
            variant={index === 0 ? "primary" : "secondary"}
            className={ACTION}
            disabled={pending}
            aria-busy={busy === key}
            onClick={() =>
              run(key, async () =>
                toastResult(await acknowledgeTask({ taskId, onBehalfOf: acting.onBehalfOf }), {
                  success: who ? `Noted for ${who}` : "Noted",
                }),
              )
            }
          >
            {busy === key ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <CheckIcon aria-hidden />
            )}
            {who ? `Noted for ${who}` : "Task Noted"}
          </Button>
        );
      })}

      {actions.done ? (
        <Button
          variant="strong"
          className={ACTION}
          disabled={pending}
          onClick={() => setDialog("done")}
        >
          {actions.done.again ? "Mark done again" : "Mark done"}
          {forName(actions.done) ? ` for ${forName(actions.done)}` : ""}
        </Button>
      ) : null}

      {actions.start ? (
        <Button
          variant="secondary"
          className={ACTION}
          disabled={pending}
          aria-busy={busy === "start"}
          onClick={() => {
            const acting = actions.start as ActingFor;
            const who = forName(acting);
            run("start", async () =>
              toastResult(await startTask({ taskId, onBehalfOf: acting.onBehalfOf }), {
                success: who ? `Started for ${who}` : "Started",
              }),
            );
          }}
        >
          {busy === "start" ? (
            <Loader2Icon className="animate-spin" aria-hidden />
          ) : (
            <PlayIcon aria-hidden />
          )}
          {forName(actions.start) ? `Start for ${forName(actions.start)}` : "Start work"}
        </Button>
      ) : null}

      {actions.review ? (
        <>
          <Button
            variant="strong"
            className={ACTION}
            disabled={pending}
            onClick={() => setDialog("approve")}
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            className={ACTION}
            disabled={pending}
            onClick={() => setDialog("reject")}
          >
            Request changes
          </Button>
        </>
      ) : null}

      {actions.takeOver ? (
        <Button
          variant="secondary"
          className={ACTION}
          disabled={pending}
          onClick={() => setDialog("takeOver")}
        >
          Decide it yourself
        </Button>
      ) : null}

      {actions.done ? (
        <DoneDialog
          open={dialog === "done"}
          onOpenChange={(open) => setDialog(open ? "done" : null)}
          taskId={taskId}
          dueAt={dueAt}
          onBehalfOf={actions.done.onBehalfOf}
          forName={forName(actions.done)}
        />
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => setDialog(open ? "approve" : null)}
        title="Approve this task?"
        description={
          actions.review === "admin"
            ? "It goes to the Owner for the final approval."
            : "This is the final approval: the task is complete."
        }
        confirmLabel="Approve task"
        onConfirm={async () =>
          toastResult(await reviewTask({ taskId, decision: "approved" }), {
            success:
              actions.review === "admin" ? "Approved: it goes to the Owner" : "Task complete",
          })
        }
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        title="Request changes"
        description={`${primaryName} sees this reason and marks it done again once it's fixed.`}
        label="What needs to change?"
        placeholder="Say what to fix."
        submitLabel="Request changes"
        onSubmit={async (reason) =>
          toastResult(await reviewTask({ taskId, decision: "rejected", reason }), {
            success: "Changes requested",
          })
        }
      />
      <ConfirmDialog
        open={dialog === "takeOver"}
        onOpenChange={(open) => setDialog(open ? "takeOver" : null)}
        title="Decide it yourself?"
        description={`${approverName ?? "The approving Admin"} has not checked it yet. Removing them as approver sends the task straight to you, and the history records it.`}
        confirmLabel={`Remove ${approverName ?? "the approver"} as approver`}
        onConfirm={async () =>
          toastResult(await setTaskApprover({ taskId, approvingAdminId: null }), {
            success: "It's yours to decide",
          })
        }
      />
    </div>
  );
}

/**
 * Done (WORKFLOWS §3.1, §3.3): an optional note whose http/https links the reviewer taps (the
 * hand-in until phase 8, kickoff 4 decision 10) and, past the deadline, the reason it is late
 * (required). A layer: back closes it.
 */
function DoneDialog({
  open,
  onOpenChange,
  taskId,
  dueAt,
  onBehalfOf,
  forName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  dueAt: string;
  onBehalfOf: string | null;
  forName: string | null;
}) {
  const [note, setNote] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [errors, setErrors] = useState<{
    note?: string | undefined;
    lateReason?: string | undefined;
  }>({});
  const [formError, setFormError] = useState<ResultError | null>(null);
  const [pending, startTransition] = useTransition();
  // Read when the dialog renders: the deadline may pass while it is open, and the function
  // decides at the moment it runs (REASON_REQUIRED then shows under the field).
  const late = systemClock().getTime() > Date.parse(dueAt) || errors.lateReason !== undefined;

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setErrors({});
      setFormError(null);
    }
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = lateReason.trim();
    if (late && reason.length < 3) {
      setErrors({ lateReason: "Say why it's late: a few words are enough." });
      return;
    }
    startTransition(async () => {
      const result = await submitDone({
        taskId,
        note: note.trim() || null,
        lateReason: late ? reason : null,
        onBehalfOf,
      });
      if (!result.ok) {
        if (result.error.code === "REASON_REQUIRED") {
          setErrors({ lateReason: result.error.message || "Say why it's late." });
        } else if (result.error.fieldErrors?.note?.[0]) {
          setErrors({ note: result.error.fieldErrors.note[0] });
        } else {
          setFormError(result.error);
        }
        return;
      }
      toastResult(result, { success: forName ? `Marked done for ${forName}` : "Marked done" });
      setNote("");
      setLateReason("");
      onOpenChange(false);
    });
  }

  const summary = formError ? describeError(formError) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-slot="task-done-dialog">
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{forName ? `Mark done for ${forName}` : "Mark done"}</DialogTitle>
            <DialogDescription>
              It goes for review. The task is locked until then; comments stay open.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <ErrorText slot="form-alert">{summary.description ?? summary.title}</ErrorText>
          ) : null}
          <FormField
            label="Note (optional)"
            hint="Paste a link to the work, such as a Drive folder: the reviewer can open it."
            error={errors.note}
          >
            {(control) => (
              <Textarea
                {...control}
                name="note"
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setErrors((current) => ({ ...current, note: undefined }));
                }}
              />
            )}
          </FormField>
          {late ? (
            <FormField label="Why is it late?" error={errors.lateReason}>
              {(control) => (
                <Textarea
                  {...control}
                  name="lateReason"
                  rows={2}
                  maxLength={REASON_MAX}
                  value={lateReason}
                  onChange={(event) => {
                    setLateReason(event.target.value);
                    setErrors((current) => ({ ...current, lateReason: undefined }));
                  }}
                  required
                />
              )}
            </FormField>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
              {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {forName ? `Mark done for ${forName}` : "Mark done"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
