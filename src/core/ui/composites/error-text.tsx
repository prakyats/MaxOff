import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";

/**
 * Error text: red **with an icon**, never colour alone (ARCHITECTURE §14.1, the action colour
 * rule: red is for the commit action, error text and attention badges only). Field messages
 * (`FormField`), form-level messages and inline refusals all use it, so an error reads the same
 * everywhere and never relies on colour to be noticed.
 */
export function ErrorText({
  children,
  id,
  slot = "field-error",
  alert = true,
  className,
}: {
  children: ReactNode;
  id?: string | undefined;
  /** `field-error` beside a control, `form-alert` above a form; specs find errors by it. */
  slot?: string;
  /** Announced at once (`role="alert"`); off only where a live region already speaks. */
  alert?: boolean;
  className?: string;
}) {
  return (
    <p
      id={id}
      data-slot={slot}
      role={alert ? "alert" : undefined}
      className={cn("text-destructive flex items-start gap-1.5 text-sm", className)}
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
