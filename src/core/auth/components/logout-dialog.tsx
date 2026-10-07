"use client";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { backToHomeThen } from "@/core/ui/shell/tab-history";
import { toastResult } from "@/core/ui/toast";

import { logout } from "../actions";

/**
 * The "Sign out of this device?" confirmation itself, opened by `LogoutProvider`, which loads
 * this file after the page (6.0, the first-load diet).
 */
export function LogoutDialog({
  open,
  onOpenChange,
  hasWorkingDay,
  unsaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Admins and Staff have a working day to reassure about; the Owner has none. */
  hasWorkingDay: boolean;
  /** An editor had unsaved changes when the confirmation was asked for (2.9). */
  unsaved: boolean;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sign out of this device?"
      description={`Notifications stop reaching this device until you sign in again, and you'll need your password.${hasWorkingDay ? " Your working day is not affected: End day is on your home screen." : ""}`}
      confirmLabel="Sign out"
      onConfirm={async () => {
        // The confirmation has its own history entry (it is a layer, §14.2 a). Back it out
        // first, or the action's redirect to /login would replace that entry and leave the
        // page underneath in the back stack (§14.2 e). The dialog stays up, pending, until
        // the redirect lands.
        await new Promise<void>((resolve) => {
          if (!closeOverlaysThen(resolve)) resolve();
        });
        // Me is a tab the installed app pushed above home: step back to home as well, so the
        // redirect's replace leaves /login alone on the stack (§14.2 c, e; 3b.1 moved the
        // sign-out off the home screen).
        await new Promise<void>((resolve) => backToHomeThen(resolve));
        // This device's push subscription goes with the sign-out (5.2): the browser's copy is
        // dropped and its endpoint handed to the action, which deletes the row.
        // Loaded on the tap, so the push code stays out of every screen's first load (A-L6); a
        // chunk that fails to load (offline) never stops the sign-out.
        const pushEndpoint = await import("@/core/notifications/push/release")
          .then((module) => module.releaseThisDevice())
          .catch(() => null);
        // On success the action redirects; only a failure comes back as a Result.
        toastResult(await logout(pushEndpoint ? { pushEndpoint } : {}));
        return true;
      }}
    >
      {unsaved ? (
        <ErrorText slot="logout-unsaved">Your unsaved changes will be lost.</ErrorText>
      ) : null}
    </ConfirmDialog>
  );
}
