import { MessageCircleIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";

import { unreadLabel } from "../domain/page";

/**
 * A task row's unread comments (Kickoff 4 decision 28): a speech bubble and the count, spoken as
 * "2 new comments". Neutral, not red: red is the commit action's, an error's and the navigation
 * badges' (ARCHITECTURE §14.1). No state, no handlers, so the server lists and the client ones
 * (all tasks, Approvals) draw the same one. Nothing when there is nothing unread.
 */
export function UnreadMarker({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      data-slot="task-unread"
      className={cn(
        "bg-muted text-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <MessageCircleIcon aria-hidden className="size-3.5" />
      <span aria-hidden>{count}</span>
      <span className="sr-only">{unreadLabel(count)}</span>
    </span>
  );
}
