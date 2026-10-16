import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
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

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Days off & holidays" };

/**
 * Settings → Days off & holidays (PRODUCT §7). Together these answer "is this a working day?"
 * (`app.is_working_day()`), which the attendance jobs of phase 2 ask every night.
 */
export default async function DaysOffSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [, [settings, holidays]] = await checkThenRead(
    requirePermission("settings.manage"),
    Promise.all([getSettings(), listHolidays()]),
  );

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Days off & holidays"
        {...SETTINGS_HEADERS.daysOff}
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
            {/* Keyed by the saved days: a save on another device re-seeds the form's state when the
                screen is re-read (6b.17a), instead of keeping what was shown before. */}
            <WeeklyOffForm
              key={settings.weeklyOffDays.join(",")}
              weeklyOffDays={settings.weeklyOffDays}
            />
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
