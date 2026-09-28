"use client";

import { createContext, type ReactNode, use, useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { anyEditDirty } from "@/core/ui/edit/edit-guard";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { backToHomeThen } from "@/core/ui/shell/tab-history";
import { toastResult } from "@/core/ui/toast";

import { logout } from "../actions";
import { ErrorText } from "@/core/ui/composites/error-text";

/**
 * The one confirmation for "Sign out of this device" (task 1.5; reworded in 3b.1, ADR-0012
 * amendment 2026-09-27).
 *
 * Signing out is no longer attendance (the working day is Start day / End day), but it is still
 * worth a confirmation: notifications stop reaching this device until the person signs in again,
 * and a password is needed to get back in. The button lives under Me only (a lost or shared
 * device), so the dialog sits in a provider above the shell as before, and the edit pattern's
 * unsaved-changes warning still reaches it (2.9).
 */
const RequestLogout = createContext<() => void>(() => undefined);

export function LogoutProvider({
  children,
  hasWorkingDay,
}: {
  children: ReactNode;
  /** Admins and Staff have a working day to reassure about; the Owner has none. */
  hasWorkingDay: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Read when the confirmation opens: an editor with unsaved changes is warned about (2.9).
  const [unsaved, setUnsaved] = useState(false);

  return (
    <RequestLogout.Provider
      value={() => {
        setUnsaved(anyEditDirty());
        setOpen(true);
      }}
    >
      {children}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
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
          // On success the action redirects; only a failure comes back as a Result.
          toastResult(await logout());
          return true;
        }}
      >
        {unsaved ? (
          <ErrorText slot="logout-unsaved">Your unsaved changes will be lost.</ErrorText>
        ) : null}
      </ConfirmDialog>
    </RequestLogout.Provider>
  );
}

/** Opens the confirmation. The actual sign-out happens when it is confirmed. */
export function useRequestLogout(): () => void {
  return use(RequestLogout);
}
