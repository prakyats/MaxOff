"use client";

import { RotateCwIcon } from "lucide-react";

import { Button } from "@/core/ui/primitives/button";

/**
 * "Reload app" under Me (ARCHITECTURE §14.2 i, owner 2026-09-28): the last resort when a screen
 * looks stuck, a full reload of the app. Everyday freshness is pull-to-refresh and refresh on
 * return, which keep what the person was doing; this one starts again from scratch, so it lives
 * one level down, not on a tab's first screen. Unsaved edits still get the browser's own
 * "Leave site?" warning (`useLeaveGuard`).
 */
export function ReloadAppButton() {
  return (
    <Button
      type="button"
      variant="secondary"
      data-slot="reload-app"
      onClick={() => window.location.reload()}
    >
      <RotateCwIcon aria-hidden />
      Reload app
    </Button>
  );
}
