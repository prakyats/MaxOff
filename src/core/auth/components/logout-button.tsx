"use client";

import { LogOutIcon } from "lucide-react";

import { Button } from "@/core/ui/primitives/button";

import { useRequestLogout } from "./logout-confirm";

/**
 * "Sign out of this device", under Me only (kickoff 3b decision 1: a lost or shared device; the
 * working day is Start day / End day, so nothing else in the app signs anyone out). It opens the
 * shared confirmation from `LogoutProvider` rather than signing out on the spot. Last on Me (V5b,
 * the Me restructure): a red outline, never solid, since nothing is destroyed; full width on a
 * phone.
 */
export function LogoutButton() {
  const requestLogout = useRequestLogout();
  return (
    <Button
      variant="destructive"
      onClick={requestLogout}
      data-slot="me-sign-out"
      className="w-full md:w-auto"
    >
      <LogOutIcon aria-hidden />
      Sign out of this device
    </Button>
  );
}
