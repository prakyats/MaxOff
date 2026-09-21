import { AlertTriangleIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

/**
 * Something failed to load or run. Used by the error boundaries and by panels that
 * fetch on the client. Pass `action` for a Retry button or a link home.
 */
export function ErrorState({
  icon: Icon = AlertTriangleIcon,
  title = "Something went wrong",
  description,
  action,
  className,
  tone = "danger",
}: {
  icon?: LucideIcon;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "danger" | "neutral";
}) {
  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border px-6 py-12 text-center",
        tone === "danger" ? "border-destructive/30 bg-destructive/5" : "border-border",
        className,
      )}
    >
      <div
        className={cn(
          "mb-3 flex size-10 items-center justify-center rounded-full",
          tone === "danger"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
