import { type ReactNode, useId } from "react";

import { cn } from "@/core/lib/utils";
import { Label } from "@/core/ui/primitives/label";
import { ErrorText } from "@/core/ui/composites/error-text";

/**
 * A labelled control with its validation message wired for assistive tech: the child gets
 * `id`, `aria-invalid` and `aria-describedby` through a render function. Forms show every
 * message next to its field (CLAUDE.md Definition of Done) and nowhere else.
 */
export function FormField({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  /** The first message wins; the rest are usually the same rule said twice. */
  error?: readonly string[] | string | undefined;
  hint?: string | undefined;
  className?: string;
  children: (control: {
    id: string;
    "aria-invalid": true | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const message = Array.isArray(error) ? error[0] : (error as string | undefined);
  const messageId = `${id}-message`;
  const hintId = `${id}-hint`;
  const describedBy = [message ? messageId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": message ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {message ? <ErrorText id={messageId}>{message}</ErrorText> : null}
    </div>
  );
}
