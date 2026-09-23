"use client";

import { LogOutIcon } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/core/ui/primitives/button";
import { DropdownMenuItem } from "@/core/ui/primitives/dropdown-menu";
import { toastResult } from "@/core/ui/toast";

import { logout } from "../actions";

function useLogout() {
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      // On success the action redirects; only a failure comes back as a Result.
      toastResult(await logout());
    });
  return { pending, run };
}

/** The "Log out" button on /me (PRODUCT §4.1: manual, the time is recorded at once). */
export function LogoutButton() {
  const { pending, run } = useLogout();
  return (
    <Button variant="outline" onClick={run} disabled={pending}>
      <LogOutIcon aria-hidden />
      {pending ? "Logging out…" : "Log out"}
    </Button>
  );
}

/** The same action as an item of the account menu in the top bar. */
export function LogoutMenuItem() {
  const { pending, run } = useLogout();
  return (
    <DropdownMenuItem onSelect={run} disabled={pending}>
      <LogOutIcon aria-hidden />
      Log out
    </DropdownMenuItem>
  );
}
