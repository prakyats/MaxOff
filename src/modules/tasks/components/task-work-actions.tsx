"use client";

import { CheckIcon, PlayIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { acknowledgeTask, reviewTask, setTaskApprover, startTask } from "../actions/tasks";
import type { ActingFor, TaskActions } from "../domain/task";

/**
 * The Done sheet's code loads on the first tap of Mark done, not with the page (4B review S12);
 * once loaded it stays mounted, so a note typed before a back is still there on the next open.
 */
const DoneDialog = dynamic(() => import("./task-done-dialog").then((module) => module.DoneDialog), {
  ssr: false,
});

type WorkActions = Pick<TaskActions, "note" | "start" | "done" | "review" | "takeOver">;

/**
 * 44px at least, and a long name ("Mark done for Asha Kumar") wraps instead of overflowing. The
 * pending label shares the label's grid cell (`Button`), so it wraps the same way and the button
 * keeps its size when it switches.
 */
const ACTION = "h-auto min-h-11 py-2 text-center whitespace-normal";

/**
 * The task's next action, on its first screen (4.4, PRODUCT §2 "First glance"): Task Noted (and
 * "Noted for Asha" for a freelancer's coordinator, ADR-0013), Start, Mark done, the review step
 * and the Owner's way past a waiting Admin. Only what the viewer may do now is shown; the
 * database decides again. The action colour rule: Task Noted is the screen's one solid red
 * commit; Mark done and Approve open a form or a confirmation (neutral solid), Request changes is
 * a red outline until its reason is sent. Task Noted, "Noted for Asha" and Start commit at the
 * tap (ARCHITECTURE §14.1): one request per tap, a working label at once ("Noting…",
 * "Starting…"), disabled offline, and a slow or lost connection said under the buttons with
 * Retry, which is safe because the transition functions refuse a second note or start.
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
  // Which of the tap-to-commit buttons sent the request on its way (its label turns to the
  // working one); every action waits while it is.
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"done" | "approve" | "reject" | "takeOver" | null>(null);
  const [doneLoaded, setDoneLoaded] = useState(false);
  const action = useAction(async (work: () => Promise<unknown>) => {
    await work();
  });
  const { pending } = action;

  const forName = (acting: ActingFor) =>
    acting.onBehalfOf ? (names[acting.onBehalfOf] ?? "them") : null;

  function run(key: string, work: () => Promise<unknown>) {
    if (pending) return;
    setBusy(key);
    action.run(work);
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
            commits
            disabled={pending && busy !== key}
            pending={pending && busy === key}
            pendingLabel={who ? `Noting for ${who}…` : "Noting…"}
            onClick={() =>
              run(key, async () =>
                toastResult(await acknowledgeTask({ taskId, onBehalfOf: acting.onBehalfOf }), {
                  success: who ? `Noted for ${who}` : "Noted",
                }),
              )
            }
          >
            <CheckIcon aria-hidden />
            {who ? `Noted for ${who}` : "Task Noted"}
          </Button>
        );
      })}

      {actions.done ? (
        <Button
          variant="strong"
          className={ACTION}
          disabled={pending}
          onClick={() => {
            setDoneLoaded(true);
            setDialog("done");
          }}
        >
          {actions.done.again ? "Mark done again" : "Mark done"}
          {forName(actions.done) ? ` for ${forName(actions.done)}` : ""}
        </Button>
      ) : null}

      {actions.start ? (
        <Button
          variant="secondary"
          className={ACTION}
          commits
          disabled={pending && busy !== "start"}
          pending={pending && busy === "start"}
          pendingLabel={
            forName(actions.start) ? `Starting for ${forName(actions.start)}…` : "Starting…"
          }
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
          <PlayIcon aria-hidden />
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
      <ActionStatus action={action} className="sm:basis-full" />

      {actions.done && doneLoaded ? (
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
