import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

/**
 * Shown when a list or panel has nothing to display. Every list screen must use it
 * (CLAUDE.md Definition of Done: loading, empty, error and permission-denied states).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "default",
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** `compact` fits inside cards and table bodies. */
  size?: "default" | "compact";
}) {
  return (
    <div
      role="status"
      data-slot="empty-state"
      className={cn(
        "border-border flex flex-col items-center justify-center rounded-lg border border-dashed text-center",
        size === "default" ? "px-6 py-12" : "px-4 py-8",
        className,
      )}
    >
      {Icon ? (
        <div className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-full">
          <Icon className="size-5" aria-hidden />
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * **The empty row** (FINAL 1 and 7, PP-task-4, PP-admin-4; V5b): what an empty section becomes.
 * One muted line in the section's place, **with no heading** ("Empty sections never take a
 * heading"), optionally followed by one inline action ("+ Add stage", a quiet `ghost` or link
 * button the caller passes). The section's normal case collapses to it: "Nothing needs you right
 * now". A screen that would only say why a section is empty shows nothing instead (PP-tasks-1).
 * A whole empty list that should teach and offer its one action is `EmptyState`.
 */
export function EmptyRow({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-row"
      className={cn(
        "text-muted-foreground flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm",
        className,
      )}
    >
      <p className="min-w-0 break-words">{children}</p>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}
