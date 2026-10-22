"use client";

import { CalendarOffIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ListAddButton, ListHeading } from "@/core/ui/composites/list-rows";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { removeHoliday } from "../actions/settings";
import { canRemoveHoliday, type Holiday, holidaysByYear, isUpcoming } from "../domain/settings";
import { AddHolidayDialog } from "./add-holiday-dialog";

/**
 * The holiday list (PRODUCT §7: none seeded, the Owner adds them). A holiday is not a working
 * day, so the absent check skips it (WORKFLOWS §1). Removing one is a real delete: it has no
 * archived state, the activity log keeps the removed row, and days already recorded keep the
 * meaning they had — an attendance day carries its own "day off" flag (2.1). Since v1.8 V5a 6b
 * (owner 2026-10-22) only a holiday still ahead has Remove: on its day or after it stays.
 */
export function HolidaysPanel({ holidays, today }: { holidays: Holiday[]; today: string }) {
  const [pendingDelete, setPendingDelete] = useState<Holiday | null>(null);
  const [adding, setAdding] = useState(false);
  const years = holidaysByYear(holidays);

  return (
    <div className="flex flex-col gap-3">
      {/* The Settings Add pattern (C4): a neutral outline on the list's heading opens the dialog,
          whose "Add holiday" is the commit; the screen's "Save days off" stays its one solid. */}
      <ListHeading
        title={`${holidays.length} ${holidays.length === 1 ? "holiday" : "holidays"}`}
        action={<ListAddButton onClick={() => setAdding(true)}>Add holiday</ListAddButton>}
      />

      {years.length === 0 ? (
        <EmptyState
          icon={CalendarOffIcon}
          title="No holidays yet"
          description='Add the company holidays for the year with "Add holiday". On those dates nobody is marked absent.'
        />
      ) : (
        <div className="flex flex-col gap-6">
          {years.map((year) => (
            <section key={year.year} className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-sm font-medium">{year.year}</h2>
              <ul
                data-slot="holiday-list"
                className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border"
              >
                {year.holidays.map((holiday) => (
                  <li
                    key={holiday.id}
                    data-slot="holiday-row"
                    className="flex min-h-14 items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{holiday.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {holiday.date} · {holiday.weekday}
                        {isUpcoming(holiday, today) ? "" : " · past"}
                      </p>
                    </div>
                    {canRemoveHoliday(holiday, today) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${holiday.name}`}
                        onClick={() => setPendingDelete(holiday)}
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          destructive
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          title={`Remove ${pendingDelete.name}?`}
          description={`${pendingDelete.date} becomes an ordinary day again. This can't be undone.`}
          confirmLabel={`Remove ${pendingDelete.name}`}
          cancelLabel="Keep it"
          onConfirm={async () => {
            toastResult(await removeHoliday({ holidayId: pendingDelete.id }), {
              success: "Holiday removed",
            });
            setPendingDelete(null);
          }}
        />
      ) : null}
      {adding ? <AddHolidayDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
