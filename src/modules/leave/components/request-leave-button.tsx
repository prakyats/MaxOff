"use client";

import { CalendarPlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import type { CompBalance } from "../domain/credits";

import { LeaveFormDialog } from "./leave-form-dialog";

/**
 * The screen's one primary action: `PageHeader` makes it a FAB on a phone (ARCHITECTURE §14.1).
 * `balance` is the comp leave balance **as a promise** (3b.2): the `/leave` layout awaits nothing
 * so its header paints at once, and the dialog reads the promise only when it opens.
 */
export function RequestLeaveButton({
  today,
  balance,
}: {
  today: string;
  balance: Promise<CompBalance>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)}>
        <CalendarPlusIcon aria-hidden />
        Request leave
      </Button>
      {open ? (
        <LeaveFormDialog today={today} balance={balance} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
