"use client";

import { Loader2Icon } from "lucide-react";
import { type ReactNode, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/core/ui/primitives/alert-dialog";
import { Button } from "@/core/ui/primitives/button";

/**
 * A confirmation for actions that don't need a reason (approve, archive, cancel a draft). Its one
 * solid red button (`primary`) is named for the action ("Deactivate Ravi", "Approve 3"), never
 * "Confirm" or "OK", whether the action is destructive or not (ARCHITECTURE §14.1).
 * `onConfirm` may be async; the dialog shows a spinner and closes when it resolves, unless it
 * resolves to `false` (something inside the dialog needs fixing first, e.g. a field message).
 * Actions that need a reason use `ReasonDialog` instead (WORKFLOWS: reject, correct, cancel).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | boolean | Promise<void | boolean>;
  /** Optional extra content between the description and the buttons. */
  children?: ReactNode;
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const keepOpen = (await onConfirm()) === false;
      if (!keepOpen) onOpenChange(false);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={pending ? () => undefined : onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button variant="primary" onClick={confirm} disabled={pending} aria-busy={pending}>
            {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
