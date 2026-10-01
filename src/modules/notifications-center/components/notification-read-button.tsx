"use client";

import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { noteOwnReadRevalidated } from "@/core/notifications/live-state";
import { systemClock } from "@/core/time/clock";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { toastResult } from "@/core/ui/toast";

import { markNotificationRead } from "../actions/inbox";

/**
 * A history row with nothing to open (someone who lost access to what it was about, kickoff 5
 * decision 25): a tap reads it. The row's own content, pressed and pending like any row.
 */
export function NotificationReadButton({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const action = useAction(async () => {
    const result = await markNotificationRead({ id });
    toastResult(result);
    if (result.ok && result.data.marked > 0) {
      noteOwnReadRevalidated(systemClock().getTime());
    }
  });
  return (
    <>
      <button
        type="button"
        data-slot="notification-read"
        aria-busy={action.pending || undefined}
        disabled={action.pending}
        onClick={() => action.run()}
        className={cn(
          className,
          "pressable-row focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
        )}
      >
        {children}
      </button>
      {/* A tap that never reached MaxOff says so, with Retry (§14.1). */}
      <ActionStatus action={action} className="px-4 pb-3" />
    </>
  );
}
