import { AlertTriangleIcon, InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

/** A one-line message above a form: a failure (`danger`) or a note such as "You're logged out". */
export function FormAlert({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "info";
  children: ReactNode;
}) {
  const Icon = tone === "danger" ? AlertTriangleIcon : InfoIcon;
  return (
    <p
      data-slot="form-alert"
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        tone === "danger"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-border bg-muted text-foreground",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
