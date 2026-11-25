import type { DrawVariant } from "@/core/ui/navigation/tap-drawings";
import { LeaveBalanceStripSkeleton, RequestLeaveButton } from "@/modules/leave/components/tap-kit";

import { LeaveRequestsSkeleton } from "../leave/(leave)/leave-requests-skeleton";
import { LeaveHeader } from "../leave/leave-header";

/** No balance: the copy's Request leave is inert, so its form never opens. */
const NO_BALANCE: Parameters<typeof RequestLeaveButton>[0]["balance"] = Promise.resolve({
  availableDays: 0,
  useBy: null,
});

/**
 * Attendance & leave's tap drawing (v7.0): the layout's header and tabs (its Request leave as the
 * layout draws it, inert in the copy), then the requests view's loading screen.
 */
export function drawLeave(): DrawVariant {
  const drawing: DrawVariant = () => (
    <>
      <LeaveHeader action={<RequestLeaveButton today="" balance={NO_BALANCE} />} />
      <LeaveRequestsSkeleton parts={{ LeaveBalanceStripSkeleton }} />
    </>
  );
  return drawing;
}
