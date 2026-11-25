import type { ReactNode } from "react";

import { PageHeader } from "@/core/ui/composites/page-header";

import { LEAVE_TABS, LeaveTabs } from "./leave-tabs";

const DESCRIPTION = "Request leave, change or cancel it, and see how each day was recorded.";

/**
 * Attendance & leave's header and its two tabs (5B decision 2), painted by the layout while a
 * view loads; the same for the tap drawing (v7.0), drawn at the tapped address (`TapDrawing.at`).
 */
export function LeaveHeader({ action }: { action: ReactNode }) {
  return (
    <>
      <PageHeader
        title="Attendance & leave"
        description={DESCRIPTION}
        help={DESCRIPTION}
        actions={action}
      />
      <LeaveTabs tabs={LEAVE_TABS} label="Attendance and leave" />
    </>
  );
}
