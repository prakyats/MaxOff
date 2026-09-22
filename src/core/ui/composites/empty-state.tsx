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
