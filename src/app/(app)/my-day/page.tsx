import { SunriseIcon } from "lucide-react";
import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import { TodayAttendanceStrip } from "@/modules/attendance";

import { getClaimSetup } from "@/modules/expenses";
import { EndDayClaims } from "@/modules/expenses/components/end-day-claims";

import { PlaceholderPage } from "../_placeholder/placeholder-page";
import { STAND_INS } from "../_placeholder/stand-ins";

export const metadata: Metadata = { title: "My Day" };

/**
 * Staff home. Today's attendance is one line on top (the strip, 2.3 polish, reworked in 3b.1:
 * "Not started · Start day", "Started 9:12 am · End day"; 6.1 builds the tasks around it), for
 * whoever marks attendance; the Owner can open this route too (no permission) but has no day.
 * Signing out lives under Me (kickoff 3b decision 1). The rest arrives in 6.1; until then the
 * stand-in says so in plain words.
 */
export default async function MyDayPage() {
  const viewer = await requireMember();
  const marksAttendance = can(viewer.role, "attendance.self");
  return (
    <PlaceholderPage greet={viewer.name} title="My Day" copy={STAND_INS.myDay} icon={SunriseIcon}>
      {marksAttendance ? (
        <TodayAttendanceStrip
          endDayFollowUp={
            // End day's "Any expenses to claim today?" (3b.3): the claim form's setup is a
            // promise, read only if the person answers Yes.
            <EndDayClaims today={todayIST()} setup={getClaimSetup().catch(() => null)} />
          }
        />
      ) : null}
    </PlaceholderPage>
  );
}
