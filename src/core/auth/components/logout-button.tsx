"use client";

import { LogOutIcon } from "lucide-react";

import { Button } from "@/core/ui/primitives/button";

import { useRequestLogout } from "./logout-confirm";

/**
 * "Sign out of this device", under Me only (kickoff 3b decision 1: a lost or shared device; the
 * working day is Start day / End day, so nothing else in the app signs anyone out). It opens the
 * shared confirmation from `LogoutProvider` rather than signing out on the spot.
 */
export function LogoutButton() {
  const requestLogout = useRequestLogout();
  return (
    <Button variant="secondary" onClick={requestLogout}>
      <LogOutIcon aria-hidden />
      Sign out
    </Button>
  );
}
