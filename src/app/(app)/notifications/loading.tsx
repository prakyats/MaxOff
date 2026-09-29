import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";

import { StandInSkeleton } from "../_placeholder/stand-in-skeleton";
import { STAND_INS } from "../_placeholder/stand-ins";

/**
 * Alerts, as it renders now (3c review: the skeleton traces the stand-in, worded as the page
 * words it: a member's requests, or the Owner's Approvals). When 5.1 builds the inbox, this goes
 * back to the plain list of rows the owner specified.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const own = member !== null && can(member.role, "attendance.self");
  return (
    <>
      <PageHeader title="Alerts" />
      <StandInSkeleton
        copy={own ? STAND_INS.alertsMember : STAND_INS.alertsOwner}
        label="Loading Alerts"
      />
    </>
  );
}
