"use client";

import { createContext, type ReactNode, use, useState } from "react";

import { anyEditDirty } from "@/core/ui/edit/edit-guard";
import { AfterPage } from "@/core/ui/lazy/after-page";

const loadDialog = () => import("./logout-dialog").then((module) => module.LogoutDialog);

/**
 * The one confirmation for "Sign out of this device" (task 1.5; reworded in 3b.1, ADR-0012
 * amendment 2026-09-27).
 *
 * Signing out is no longer attendance (the working day is Start day / End day), but it is still
 * worth a confirmation: notifications stop reaching this device until the person signs in again,
 * and a password is needed to get back in. The button lives under Me only (a lost or shared
 * device), so the dialog sits in a provider above the shell as before, and the edit pattern's
 * unsaved-changes warning still reaches it (2.9). The dialog itself (`logout-dialog.tsx`) is
 * loaded after the page (6.0, the first-load diet): it draws nothing until it is asked for.
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
      {/* Drawn once its code has arrived (right after the page); a request before then opens
          it as soon as it does. */}
      <AfterPage
        load={loadDialog}
        props={{ open, onOpenChange: setOpen, hasWorkingDay, unsaved }}
      />
    </RequestLogout.Provider>
  );
}

/** Opens the confirmation. The actual sign-out happens when it is confirmed. */
export function useRequestLogout(): () => void {
  return use(RequestLogout);
}
