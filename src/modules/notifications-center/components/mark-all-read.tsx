"use client";

import { noteOwnReadRevalidated } from "@/core/notifications/live-state";
import { systemClock } from "@/core/time/clock";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { markAllNotificationsRead } from "../actions/inbox";

/**
 * "Mark all read" (kickoff 5 decision 4). Not the screen's commit: a neutral outline
 * (ARCHITECTURE §14.1's colour rule; Alerts has no red action). The answer revalidates the list
 * and the bell.
 */
export function MarkAllRead() {
  const action = useAction(async () => {
    const result = await markAllNotificationsRead();
    toastResult(result);
    if (result.ok && result.data.marked > 0) {
      noteOwnReadRevalidated(systemClock().getTime());
    }
  });
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        pending={action.pending}
        pendingLabel="Marking…"
        data-slot="mark-all-read"
        onClick={() => action.run()}
      >
        Mark all read
      </Button>
      <ActionStatus action={action} />
    </span>
  );
}
