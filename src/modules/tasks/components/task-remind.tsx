"use client";

import { useEffect, useState } from "react";

import { systemClock } from "@/core/time";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ICONS } from "@/core/ui/icons";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { remindTask } from "../actions/tasks";

/**
 * Remind (6b.2, owner 2026-10-07; the task page only, never Today): the task's creator, its
 * approving Admin or the Owner asks everyone on the task about it with one tap (a push and an
 * in-app row, "<name> is asking about <task>"). At most once an hour per task: after a send, and
 * while the hour of anyone's last one runs, the button says when it can be used again and waits.
 * An outlined button (never a second solid action on the layer) naming whom it reaches ("Remind
 * Sam and Ria"); no confirmation, because the database refuses a second reminder within the hour.
 * Where it sits: a phone's own row under the "needed" callout; a laptop's next-step box, at its
 * right end (the task chat height sample, owner 23 Oct).
 */
export function TaskRemind({
  taskId,
  againAt,
  againLabel,
  who,
}: {
  taskId: string;
  /** When it can be used again (ISO), or null when it can be used now. */
  againAt: string | null;
  /** "Reminded · again at 4:05 pm", the server's words for `againAt`. */
  againLabel: string | null;
  /** Whom it reaches, from `remindWho`: "Sam", "Sam and Ria", "Sam and 2 others". */
  who: string;
}) {
  const [wait, setWait] = useState<{ at: string; label: string } | null>(
    againAt && againLabel ? { at: againAt, label: againLabel } : null,
  );
  // A fresh render of the page (after a send elsewhere, or a reload) brings the server's answer.
  const [seen, setSeen] = useState(againAt);
  if (seen !== againAt) {
    setSeen(againAt);
    setWait(againAt && againLabel ? { at: againAt, label: againLabel } : null);
  }
  // The hour ends while the page is open: one timer for that moment, never a refresh loop.
  useEffect(() => {
    if (!wait) return;
    const left = Math.max(0, Date.parse(wait.at) - systemClock().getTime());
    const timer = window.setTimeout(() => setWait(null), left);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const action = useAction(async () => {
    const result = await remindTask({ taskId });
    toastResult(result, { success: `Reminder sent to ${who}` });
    if (result.ok) setWait({ at: result.data.againAt, label: result.data.label });
  });

  return (
    // On a laptop it sits at the right end of the next-step box (task chat height, owner 23 Oct);
    // a phone keeps it on its own row under the box, as before.
    <div
      data-slot="task-remind"
      className="flex min-w-0 flex-col items-start gap-1 md:shrink-0 md:items-end"
    >
      <Button
        type="button"
        variant="secondary"
        commits
        className="h-auto min-h-11 whitespace-normal md:min-h-9"
        pending={action.pending}
        pendingLabel="Sending…"
        disabled={wait !== null}
        data-state={wait ? "waiting" : "ready"}
        title="Sends them a push and a note in the app. Once an hour per task."
        onClick={() => action.run()}
      >
        <ICONS.remind aria-hidden />
        {wait ? wait.label : `Remind ${who}`}
      </Button>
      <ActionStatus action={action} />
    </div>
  );
}
