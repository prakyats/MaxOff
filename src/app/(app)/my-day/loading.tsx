import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageHeader } from "@/core/ui/composites/page-header";
import { TodayAttendanceStripSkeleton } from "@/modules/attendance";

import { StandInSkeleton } from "../_placeholder/stand-in-skeleton";
import { dayStandIn, standInDescription } from "../_placeholder/stand-ins";

/**
 * My Day, as it renders now (3c review: the skeleton traces the stand-in): the one-line
 * attendance strip (2.3) for whoever marks attendance, then the stand-in worded for the viewer
 * (`myDay` for Staff, whose home this is; the Owner reads the team's). Same member check as
 * `today/loading.tsx`. When 6.1 builds the tasks around the strip, this goes back to the card
 * list the owner specified.
 */
export default async function Loading() {
  const member = await getCurrentMember();
  const strip = member !== null && can(member.role, "attendance.self");
  const copy = dayStandIn(member?.role ?? "staff");
  return (
    <>
      <PageHeader title="My Day" description={standInDescription(copy, member?.name)} />
      {strip ? <TodayAttendanceStripSkeleton /> : null}
      <StandInSkeleton copy={copy} label="Loading My Day" />
    </>
  );
}
