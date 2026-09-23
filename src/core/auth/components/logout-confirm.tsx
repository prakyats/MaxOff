"use client";

import { createContext, type ReactNode, use, useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { toastResult } from "@/core/ui/toast";

import { logout } from "../actions";

/**
 * One confirmation for every Log out in the app (task 1.5).
 *
 * Logging out is not just leaving the page: it **records the time** (WORKFLOWS §1
 * `session_logout`, and 2.1 extends it to `attendance_days.last_logout_at`), so a mis-tap
 * writes a real attendance event that someone then has to correct. That earns a confirmation.
 *
 * The dialog lives in a provider above the shell rather than next to each button, because two
 * of the three entry points sit inside something that closes: the account menu closes when you
 * select an item, and the More sheet closes when you tap a row. A dialog rendered inside either
 * would unmount with it and never appear.
 */
const RequestLogout = createContext<() => void>(() => undefined);

export function LogoutProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <RequestLogout.Provider value={() => setOpen(true)}>
      {children}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Log out?"
        description="This records your logout time on this device. You'll need your password to sign back in."
        confirmLabel="Log out"
        onConfirm={async () => {
          // On success the action redirects; only a failure comes back as a Result.
          toastResult(await logout());
        }}
      />
    </RequestLogout.Provider>
  );
}

/** Opens the confirmation. The actual sign-out happens when it is confirmed. */
export function useRequestLogout(): () => void {
  return use(RequestLogout);
}
