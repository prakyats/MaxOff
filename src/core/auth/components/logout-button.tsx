"use client";

import { LogOutIcon } from "lucide-react";

import { Button } from "@/core/ui/primitives/button";
import { DropdownMenuItem } from "@/core/ui/primitives/dropdown-menu";

import { useRequestLogout } from "./logout-confirm";

/**
 * The three ways to log out. None of them signs anyone out on the spot: each opens the shared
 * confirmation from `LogoutProvider`, because logging out records the time (WORKFLOWS §1) and a
 * mis-tap would leave an attendance event for the Owner to correct.
 */

/** The "Log out" button on /me (PRODUCT §4.1: manual, the time is recorded at once). */
export function LogoutButton() {
  const requestLogout = useRequestLogout();
  return (
    <Button variant="outline" onClick={requestLogout}>
      <LogOutIcon aria-hidden />
      Log out
    </Button>
  );
}

/**
 * The quiet full-width row at the bottom of My Day and the Admin's /today (2.3 polish): Log out
 * stays one tap away on the home screen — it records the time — without a card of its own.
 */
export function LogoutRow() {
  const requestLogout = useRequestLogout();
  return (
    <div data-slot="logout-row" className="border-border mt-8 border-t pt-2">
      <Button
        variant="ghost"
        onClick={requestLogout}
        className="text-muted-foreground w-full justify-center"
      >
        <LogOutIcon aria-hidden />
        Log out
      </Button>
    </div>
  );
}

/** The same action as an item of the account menu in the top bar. */
export function LogoutMenuItem() {
  const requestLogout = useRequestLogout();
  return (
    <DropdownMenuItem onSelect={requestLogout}>
      <LogOutIcon aria-hidden />
      Log out
    </DropdownMenuItem>
  );
}

/**
 * The same action as a row of the mobile More sheet (task 1.5). Logging out records the time,
 * so on a phone it has to be reachable in one tap from the bottom bar rather than behind a
 * brand bar that has scrolled away.
 */
export function LogoutSheetItem() {
  const requestLogout = useRequestLogout();
  return (
    <Button
      variant="ghost"
      onClick={requestLogout}
      className="min-h-12 w-full justify-start gap-3 px-3 font-normal"
    >
      <LogOutIcon aria-hidden />
      Log out
    </Button>
  );
}
