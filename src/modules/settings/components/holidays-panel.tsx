"use client";

import { CalendarOffIcon, Trash2Icon } from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { toastResult } from "@/core/ui/toast";

import { createHoliday, removeHoliday } from "../actions/settings";
import { type Holiday, holidaysByYear, isUpcoming } from "../domain/settings";
import { FormError } from "./form-error";

/**
 * The holiday list (PRODUCT §7: none seeded, the Owner adds them). A holiday is not a working
 * day, so the absent check skips it (WORKFLOWS §1). Removing one is a real delete: it has no
 * archived state, the activity log keeps the removed row, and days already recorded keep the
 * meaning they had — an attendance day carries its own "day off" flag (2.1).
 */
export function HolidaysPanel({ holidays, today }: { holidays: Holiday[]; today: string }) {
  const [pendingDelete, setPendingDelete] = useState<Holiday | null>(null);
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<null> | null, formData: FormData) => {
      const result = await createHoliday({
        date: String(formData.get("date") ?? ""),
        name: String(formData.get("name") ?? ""),
      });
      if (result.ok) toast.success("Holiday added");
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;
  const fieldErrors = error?.fieldErrors ?? {};
  const years = holidaysByYear(holidays);

  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        noValidate
        className="border-border flex flex-col gap-4 rounded-lg border p-4"
      >
        <FormError error={error} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <FormField label="Date" error={fieldErrors.date} className="sm:w-48">
            {(control) => <Input {...control} name="date" type="date" required />}
          </FormField>
          <FormField label="Name" error={fieldErrors.name} className="flex-1">
            {(control) => (
              <Input {...control} name="name" placeholder="Diwali" maxLength={120} required />
            )}
          </FormField>
          <Button type="submit" disabled={pending} className="w-full sm:mt-6 sm:w-auto">
            {pending ? "Adding…" : "Add holiday"}
          </Button>
        </div>
      </form>

      {years.length === 0 ? (
        <EmptyState
          icon={CalendarOffIcon}
          title="No holidays yet"
          description="Add the company holidays for the year. On those dates nobody is marked absent."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {years.map((year) => (
            <section key={year.year} className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-sm font-medium">{year.year}</h2>
              <ul
                data-slot="holiday-list"
                className="border-border divide-border divide-y rounded-lg border"
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${holiday.name}`}
                      onClick={() => setPendingDelete(holiday)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          title={`Remove ${pendingDelete.name}?`}
          description={`${pendingDelete.date} becomes an ordinary day again. Days already recorded keep the meaning they had.`}
          confirmLabel="Remove"
          destructive
          onConfirm={async () => {
            toastResult(await removeHoliday({ holidayId: pendingDelete.id }), {
              success: "Holiday removed",
            });
            setPendingDelete(null);
          }}
        />
      ) : null}
    </div>
  );
}
