import { Undo2Icon } from "lucide-react";

import { cn } from "@/core/lib/utils";

/**
 * A deliverable's send-back or reopen (6b.11 (4)): "Reopened by Ravi, 9 Oct: the client asked for
 * a new cut", muted with an icon and wrapping, never as plain body text. The row and the item
 * sheet draw the same note.
 */
export function SentBackNote({
  text,
  slot,
  className,
}: {
  text: string;
  slot: string;
  className?: string;
}) {
  return (
    <span
      data-slot={slot}
      className={cn(
        "text-muted-foreground flex min-w-0 items-start gap-1.5 text-xs break-words",
        className,
      )}
    >
      <Undo2Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">{text}</span>
    </span>
  );
}
