"use client";

import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
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

/** Runs before the sign-out; `false` keeps the confirmation open (e.g. a note to fix first). */
type BeforeLogout = () => Promise<boolean>;
const RegisterBeforeLogout = createContext<(fn: BeforeLogout | null) => void>(() => undefined);

/**
 * `extra` is rendered inside the confirmation, between the description and the buttons: the
 * app layout puts the optional overtime note there for whoever marks attendance (2.3 polish).
 * `core` never imports a module, so the module's component arrives as a prop and takes part
 * through `useBeforeLogout`.
 */
export function LogoutProvider({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const before = useRef<BeforeLogout | null>(null);

  return (
    <RequestLogout.Provider value={() => setOpen(true)}>
      <RegisterBeforeLogout.Provider value={(fn) => (before.current = fn)}>
        {children}
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Log out?"
          description="This records your logout time on this device. You'll need your password to sign back in."
          confirmLabel="Log out"
          onConfirm={async () => {
            if (before.current && !(await before.current())) return false;
            // The confirmation has its own history entry (it is a layer, §14.2 a). Back it out
            // first, or the action's redirect to /login would replace that entry and leave the
            // page underneath in the back stack (§14.2 e). The dialog stays up, pending, until
            // the redirect lands.
            await new Promise<void>((resolve) => {
              if (!closeOverlaysThen(resolve)) resolve();
            });
            // On success the action redirects; only a failure comes back as a Result.
            toastResult(await logout());
            return true;
          }}
        >
          {extra}
        </ConfirmDialog>
      </RegisterBeforeLogout.Provider>
    </RequestLogout.Provider>
  );
}

/**
 * Lets content inside the confirmation run first when Log out is confirmed. Returning `false`
 * keeps the dialog open and nothing is signed out. Unregisters on unmount.
 */
export function useBeforeLogout(fn: BeforeLogout): void {
  const register = use(RegisterBeforeLogout);
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    register(() => latest.current());
    return () => register(null);
  }, [register]);
}

/** Opens the confirmation. The actual sign-out happens when it is confirmed. */
export function useRequestLogout(): () => void {
  return use(RequestLogout);
}
