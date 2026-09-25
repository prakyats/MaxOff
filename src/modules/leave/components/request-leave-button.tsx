"use client";

import { CalendarPlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import { LeaveFormDialog } from "./leave-form-dialog";

/** The screen's one primary action: `PageHeader` makes it a FAB on a phone (ARCHITECTURE §14.1). */
export function RequestLeaveButton({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)}>
        <CalendarPlusIcon aria-hidden />
        Request leave
      </Button>
      {open ? <LeaveFormDialog today={today} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
