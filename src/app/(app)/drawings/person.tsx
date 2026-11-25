import type { ReactNode } from "react";

import { can } from "@/core/permissions";
import type { DrawVariant } from "@/core/ui/navigation/tap-drawings";
import type { ShellRole } from "@/core/ui/shell/viewer";
import {
  MonthSummarySkeleton,
  PersonTodayLineSkeleton,
} from "@/modules/attendance/components/tap-kit";

import { PersonAttendanceSkeleton } from "../people/[id]/attendance/attendance-skeleton";
import { PersonLeaveSkeleton } from "../people/[id]/leave/leave-skeleton";
import { PersonMonthSkeleton } from "../people/[id]/month/month-skeleton";
import { PersonHeaderSkeleton } from "../people/[id]/person-header-skeleton";
import { PersonProfileSkeleton } from "../people/[id]/person-profile-skeleton";

/**
 * A person's tap drawing (v7.0), by view: the layout's header while it streams in (for the Owner
 * the today line and the tabs' shape), then the view's loading screen.
 */
export function drawPerson(role: ShellRole): DrawVariant {
  const owner = can(role, "attendance.view_all");
  const view: Record<string, ReactNode> = {
    profile: <PersonProfileSkeleton canEdit={can(role, "team.manage")} owner={owner} />,
    leave: <PersonLeaveSkeleton />,
    attendance: <PersonAttendanceSkeleton />,
    month: (
      <PersonMonthSkeleton
        parts={{ MonthSummarySkeleton }}
        seesExpenses={can(role, "expenses.decide")}
      />
    ),
  };
  const drawing: DrawVariant = (variant) => (
    <>
      <PersonHeaderSkeleton
        parts={{ PersonTodayLineSkeleton }}
        manages={can(role, "team.manage")}
        owner={owner}
      />
      {view[variant]}
    </>
  );
  return drawing;
}
