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
 * "Are you sure?" for actions that don't need a reason (approve, archive, cancel a draft).
 * `onConfirm` may be async; the dialog shows a spinner and closes when it resolves.
 * Actions that need a reason use `ReasonDialog` instead (WORKFLOWS: reject, correct, cancel).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  /** Optional extra content between the description and the buttons. */
  children?: ReactNode;
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      await onConfirm();
      onOpenChange(false);
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
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={confirm}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
