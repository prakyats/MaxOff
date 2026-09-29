"use client";

import type { ReactNode } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { workingLabel } from "@/core/ui/action/working-label";

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
 * While it runs, the button says what is happening ("Deactivating Ravi…", `workingLabel`), and a
 * slow or failed request is said under it with Retry (`useAction`, ARCHITECTURE §14.1).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  onConfirm,
  confirmDisabled = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  /** The button while it runs; defaults to the label's verb in -ing ("Approving 3…"). */
  pendingLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | boolean | Promise<void | boolean>;
  /** The commit waits for something inside the dialog (a choice still to make). */
  confirmDisabled?: boolean;
  /** Optional extra content between the description and the buttons. */
  children?: ReactNode;
}) {
  const action = useAction(async () => {
    const keepOpen = (await onConfirm()) === false;
    if (!keepOpen) onOpenChange(false);
  });
  const { pending } = action;

  return (
    <AlertDialog open={open} onOpenChange={pending ? () => undefined : onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <ActionStatus action={action} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button
            variant="primary"
            onClick={() => action.run()}
            disabled={confirmDisabled}
            pending={pending}
            pendingLabel={pendingLabel ?? workingLabel(confirmLabel)}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
