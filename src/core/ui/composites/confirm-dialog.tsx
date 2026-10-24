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
 * solid button is named for the action ("Remove Diwali", "Approve 3"), never "Confirm" or "OK":
 * the neutral `primary` commit, the red `danger` one when the act is `destructive` (it
 * discards, removes or withdraws something; archiving is not destructive), or the Forest green
 * `approve` one for a positive final decision (`approve`). ADR-0015 and its 2026-10-21 amendment.
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
  cancelLabel,
  onConfirm,
  confirmDisabled = false,
  confirmHidden = false,
  destructive = false,
  approve = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  /** The button while it runs; defaults to the label's verb in -ing ("Approving 3…"). */
  pendingLabel?: string;
  /**
   * The way out. Defaults to "Keep it" for a destructive act (PP-forms-3: the dismiss says what it
   * keeps), "Close" when there is nothing to commit, else "Cancel".
   */
  cancelLabel?: string;
  onConfirm: () => void | boolean | Promise<void | boolean>;
  /** The commit waits for something inside the dialog (a choice still to make). */
  confirmDisabled?: boolean;
  /**
   * There is nothing to commit after all (the Owner's Delete of something in use, V5a 6c): the
   * dialog only explains, and its one button is the way out.
   */
  confirmHidden?: boolean;
  /** The act destroys something (discard, remove, withdraw): its commit is the red `danger`. */
  destructive?: boolean;
  /**
   * A positive final decision (Approve, Approve all, Mark done, Grant comp leave): its commit is
   * the Forest green `approve` (colour plan, ADR-0015 amendment 2026-10-21).
   */
  approve?: boolean;
  /** Optional extra content between the description and the buttons. */
  children?: ReactNode;
}) {
  const action = useAction(
    async () => {
      const keepOpen = (await onConfirm()) === false;
      if (!keepOpen) onOpenChange(false);
    },
    { resetKey: open },
  );
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
          <AlertDialogCancel disabled={pending}>
            {cancelLabel ?? (confirmHidden ? "Close" : destructive ? "Keep it" : "Cancel")}
          </AlertDialogCancel>
          {confirmHidden ? null : (
            <Button
              variant={destructive ? "danger" : approve ? "approve" : "primary"}
              onClick={() => action.run()}
              disabled={confirmDisabled}
              pending={pending}
              pendingLabel={pendingLabel ?? workingLabel(confirmLabel)}
            >
              {confirmLabel}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
