import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/primitives/card";
import { describeWeeklyOff, getSettings, listHolidays } from "@/modules/settings";
import { HolidaysPanel } from "@/modules/settings/components/holidays-panel";
import { WeeklyOffForm } from "@/modules/settings/components/weekly-off-form";

export const metadata: Metadata = { title: "Days off & holidays" };

/**
 * Settings → Days off & holidays (PRODUCT §7). Together these answer "is this a working day?"
 * (`app.is_working_day()`), which the attendance jobs of phase 2 ask every night.
 */
export default async function DaysOffSettingsPage() {
  await requirePermission("settings.manage");
  const [settings, holidays] = await Promise.all([getSettings(), listHolidays()]);

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Days off & holidays"
        description="A day off means nobody is marked absent. People may still log in and mark attendance, and the day shows as worked on a day off."
        help="A day off means nobody is marked absent. People may still log in and mark attendance, and the day shows as worked on a day off."
      />
      <div className="flex max-w-3xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Weekly off</CardTitle>
            <CardDescription>
              Currently {describeWeeklyOff(settings.weeklyOffDays)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WeeklyOffForm weeklyOffDays={settings.weeklyOffDays} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Holidays</CardTitle>
            <CardDescription>
              Company holidays, in IST. Nothing is seeded: add the dates that apply this year.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HolidaysPanel holidays={holidays} today={todayIST()} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
