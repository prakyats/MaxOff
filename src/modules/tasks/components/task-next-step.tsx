"use client";

import { CheckIcon, PlayIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";
import { isKeyboardOpen } from "@/core/ui/viewport/keyboard";
import { useKeyboard } from "@/core/ui/viewport/use-keyboard";

import { acknowledgeTask, reviewTask, setTaskApprover, startTask } from "../actions/tasks";
import type { NextStep } from "../domain/page";
import type { ActingFor } from "../domain/task";

import { useTaskView } from "./task-view";

/**
 * The Done sheet's code loads on its first open, not with the page (4B review S12); once loaded
 * it stays mounted, so a note typed before a back is still there on the next open.
 */
const DoneDialog = dynamic(() => import("./task-done-dialog").then((module) => module.DoneDialog), {
  ssr: false,
});

/**
 * 44px at least, and a long name ("Mark done for Asha Kumar") wraps instead of overflowing. The
 * pending label shares the label's grid cell (`Button`), so it wraps the same way and the button
 * keeps its size when it switches.
 */
const ACTION = "h-auto min-h-11 py-2 text-center whitespace-normal";

/**
 * The task's next step (Kickoff 4 decision 26): **only the one step the viewer takes now**, in
 * the order the work goes (Task Noted → Start work → Mark done, one at a time; Approve or Request
 * changes for the step's reviewer); everything else is under ⋯. On a phone it is a sticky bar at
 * the bottom (a layer of its own for the colour rule), hidden while the keyboard is open
 * (decision 32); from `md` up, a row under the first glance. The colour rule: one solid button,
 * no second: Task Noted and Start work commit at the tap (solid red, "Noting…", "Starting…",
 * disabled offline, Retry after a lost reply: the transition functions refuse a second note or
 * start); Mark done and Approve open a sheet or a confirmation (neutral solid), and Request
 * changes is a red outline until its reason is sent.
 *
 * It also holds the step dialogs the ⋯ opens (Mark done while Start is the step, and the Owner's
 * "Decide it yourself"), so each exists once and a typed note survives.
 */
export function TaskNextStep({
  taskId,
  dueAt,
  next,
  done,
  review,
  names,
  approverName,
  primaryName,
}: {
  taskId: string;
  dueAt: string;
  next: NextStep | null;
  /** The viewer's Mark done, whether it is the step or waits under ⋯. */
  done: (ActingFor & { again: boolean }) | null;
  /** The review step the viewer decides, for the confirmation's words. */
  review: "admin" | "owner" | null;
  names: Record<string, string>;
  approverName: string | null;
  primaryName: string;
}) {
  const { dialog, setDialog } = useTaskView();
  const keyboard = isKeyboardOpen(useKeyboard());
  const [doneLoaded, setDoneLoaded] = useState(false);
  const action = useAction(async (work: () => Promise<unknown>) => {
    await work();
  });
  const { pending } = action;
  if (dialog === "done" && !doneLoaded) setDoneLoaded(true);

  const forName = (acting: ActingFor) =>
    acting.onBehalfOf ? (names[acting.onBehalfOf] ?? "them") : null;

  function commit(work: () => Promise<unknown>) {
    if (pending) return;
    action.run(work);
  }

  let buttons: ReactNode = null;
  if (next?.kind === "note") {
    const who = forName(next.acting);
    const onBehalfOf = next.acting.onBehalfOf;
    buttons = (
      <Button
        variant="primary"
        className={ACTION}
        pending={pending}
        pendingLabel={who ? `Noting for ${who}…` : "Noting…"}
        onClick={() =>
          commit(async () =>
            toastResult(await acknowledgeTask({ taskId, onBehalfOf }), {
              success: who ? `Noted for ${who}` : "Noted",
            }),
          )
        }
      >
        <CheckIcon aria-hidden />
        {who ? `Noted for ${who}` : "Task Noted"}
      </Button>
    );
  } else if (next?.kind === "start") {
    const who = forName(next.acting);
    const onBehalfOf = next.acting.onBehalfOf;
    buttons = (
      <Button
        variant="primary"
        className={ACTION}
        pending={pending}
        pendingLabel={who ? `Starting for ${who}…` : "Starting…"}
        onClick={() =>
          commit(async () =>
            toastResult(await startTask({ taskId, onBehalfOf }), {
              success: who ? `Started for ${who}` : "Started",
            }),
          )
        }
      >
        <PlayIcon aria-hidden />
        {who ? `Start work for ${who}` : "Start work"}
      </Button>
    );
  } else if (next?.kind === "done") {
    const who = forName(next.acting);
    buttons = (
      // pending: none (it opens the Done sheet, whose Mark done commits)
      <Button variant="strong" className={ACTION} onClick={() => setDialog("done")}>
        {next.again ? "Mark done again" : "Mark done"}
        {who ? ` for ${who}` : ""}
      </Button>
    );
  } else if (next?.kind === "review") {
    buttons = (
      <>
        <Button variant="destructive" className={ACTION} onClick={() => setDialog("reject")}>
          Request changes
        </Button>
        {/* pending: none (it opens the confirmation, whose Approve task commits) */}
        <Button variant="strong" className={ACTION} onClick={() => setDialog("approve")}>
          Approve
        </Button>
      </>
    );
  }

  return (
    <>
      {buttons ? (
        <StickyActions keyboardOpen={keyboard} className="md:justify-start">
          <div data-slot="task-next-step" className="flex min-w-0 flex-col gap-2">
            <div className="flex gap-2 *:flex-1 md:*:flex-none">{buttons}</div>
            <ActionStatus action={action} />
          </div>
        </StickyActions>
      ) : null}

      {done && doneLoaded ? (
        <DoneDialog
          open={dialog === "done"}
          onOpenChange={(open) => setDialog(open ? "done" : null)}
          taskId={taskId}
          dueAt={dueAt}
          onBehalfOf={done.onBehalfOf}
          forName={forName(done)}
        />
      ) : null}

      <ConfirmDialog
        open={dialog === "approve"}
        onOpenChange={(open) => setDialog(open ? "approve" : null)}
        title="Approve this task?"
        description={
          review === "admin"
            ? "It goes to the Owner for the final approval."
            : "This is the final approval: the task is complete."
        }
        confirmLabel="Approve task"
        onConfirm={async () =>
          toastResult(await reviewTask({ taskId, decision: "approved" }), {
            success: review === "admin" ? "Approved: it goes to the Owner" : "Task complete",
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
    </>
  );
}
