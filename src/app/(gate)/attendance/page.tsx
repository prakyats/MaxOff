import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { gateNext, isGated } from "@/core/auth/day-gate";
import { touchToday } from "@/core/auth/gate";
import { requireMember } from "@/core/auth/server";
import { dayLabel } from "@/modules/attendance";
import { DayChoiceForm } from "@/modules/attendance/components/day-choice-form";

export const metadata: Metadata = { title: "Today's attendance" };

/**
 * `/attendance?next=…`: the choice screen (WORKFLOWS §1). Reached from the `(app)` layout while
 * today has no answer, or from the attendance card when the day went back to the gate. A day
 * that no longer needs a choice goes straight on to `next` (the layout there issues the pass).
 */
export default async function AttendanceGatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const member = await requireMember();
  const params = await searchParams;
  const next = gateNext(typeof params.next === "string" ? params.next : null);
  if (!isGated(member.role)) redirect(next);

  const today = await touchToday();
  if (!today.gateRequired) redirect(next);

  const firstName = member.name.split(" ")[0] ?? member.name;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-sm">{dayLabel(today.workDate)}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {today.isDayOff ? "Today is a day off" : `Good to see you, ${firstName}`}
        </h1>
        <p className="text-muted-foreground">
          {today.isDayOff
            ? "Working anyway? Choose Present and it counts as a day worked on a day off."
            : "Choose today's attendance to open MaxOff. The Owner reviews it."}
        </p>
      </div>
      <DayChoiceForm workDate={today.workDate} next={next} />
    </div>
  );
}
