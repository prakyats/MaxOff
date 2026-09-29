"use client";

import { Loader2Icon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";

import type { ActionState } from "./use-action";
import { NETWORK_ERROR_CREATE_MESSAGE, NETWORK_ERROR_MESSAGE, SLOW_MESSAGE } from "./network-error";

/**
 * The line under a commit button (ARCHITECTURE §14.1, owner 2026-09-28): nothing while all is
 * well; "Still working… slow connection" once an action has taken 8 s; "Couldn't reach MaxOff.
 * Check your connection and try again." with **Retry** when it never got an answer. Near the
 * control, never a blocking overlay. The error line is `ErrorText` (red text with its icon, the
 * one sanctioned red besides the commit action); Retry is `secondary`, so a layer keeps its one
 * red commit action.
 */
export function ActionStatus({
  action,
  className,
}: {
  action: Pick<ActionState, "slow" | "failed" | "retry" | "creates">;
  className?: string;
}) {
  if (action.failed && action.creates) {
    // A create may have landed before the reply was lost: no Retry, which could duplicate it.
    return (
      <div data-slot="action-failed" className={className}>
        <ErrorText slot="form-alert">{NETWORK_ERROR_CREATE_MESSAGE}</ErrorText>
      </div>
    );
  }
  if (action.failed) {
    return (
      <div
        data-slot="action-failed"
        className={cn("flex flex-wrap items-center justify-between gap-2", className)}
      >
        <ErrorText slot="form-alert">{NETWORK_ERROR_MESSAGE}</ErrorText>
        <Button type="button" variant="secondary" size="sm" onClick={action.retry}>
          Retry
        </Button>
      </div>
    );
  }
  if (action.slow) {
    return (
      <p
        role="status"
        data-slot="action-slow"
        className={cn("text-muted-foreground flex items-center gap-2 text-sm", className)}
      >
        <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {SLOW_MESSAGE}
      </p>
    );
  }
  return null;
}
