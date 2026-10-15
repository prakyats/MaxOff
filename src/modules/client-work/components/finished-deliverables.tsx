import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/core/lib/utils";

import { DELIVERABLE_COLUMNS } from "./deliverable-columns";

/**
 * The collapsed "Done and closed (N)" group at the end of the project page's list (6b.11 (1)):
 * done, closed and carried deliverables, out of the way of the open ones. Opening it is a **view
 * control** (ARCHITECTURE §14.2): it adds no history, and back leaves the page as before. It stays
 * as it was while the page re-reads its list after a change.
 */
export function FinishedDeliverables({
  count,
  children,
}: {
  count: number;
  /** The rows (`DeliverableRow`), drawn only while open. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <section
      aria-label="Done and closed"
      data-slot="finished-deliverables"
      className="flex flex-col gap-2"
    >
      <button
        type="button"
        aria-expanded={open}
        data-slot="finished-toggle"
        onClick={() => setOpen((current) => !current)}
        className="pressable-row text-muted-foreground hover:text-foreground flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm font-medium"
      >
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
            !open && "-rotate-90",
          )}
        />
        Done and closed <span className="tabular-nums">({count})</span>
      </button>
      {open ? (
        <ul
          aria-label="Done and closed deliverables"
          data-slot="finished-items"
          className={cn(
            "border-border divide-border bg-card divide-y overflow-hidden rounded-lg border",
            DELIVERABLE_COLUMNS,
          )}
        >
          {children}
        </ul>
      ) : null}
    </section>
  );
}
