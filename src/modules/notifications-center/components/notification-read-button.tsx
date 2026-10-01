"use client";

import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { noteNotificationsChanged } from "@/core/notifications/live-state";
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
    if (toastResult(await markNotificationRead({ id }))) noteNotificationsChanged();
  });
  return (
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
  );
}
