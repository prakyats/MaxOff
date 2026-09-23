"use client";

import { useActionState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors";
import { FormField } from "@/core/ui/composites/form-field";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { updateThresholds } from "../actions/settings";
import type { Thresholds } from "../domain/settings";
import { FormError } from "./form-error";

/**
 * The timings that drive reminders and escalations (PRODUCT §7, WORKFLOWS §9). Nothing reads
 * them yet: tasks arrive in phase 4 and the jobs in 2.5 and 5.3. Changing one never rewrites
 * what already happened — each job reads the value when it runs.
 */
export function ThresholdsForm({ thresholds }: { thresholds: Thresholds }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<null> | null, formData: FormData) => {
      const value = (name: string) => String(formData.get(name) ?? "");
      const result = await updateThresholds({
        logoutReminderTime: value("logoutReminderTime"),
        ackRepeatHours: value("ackRepeatHours"),
        ackEscalateHours: value("ackEscalateHours"),
        ackEscalateOwnerHours: value("ackEscalateOwnerHours"),
        overdueEscalateHours: value("overdueEscalateHours"),
        emailDailyCapPerMember: value("emailDailyCapPerMember"),
      });
      if (result.ok) toast.success("Thresholds saved");
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;
  const fieldErrors = error?.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="flex max-w-xl flex-col gap-4">
      <FormError error={error} />
      <FormField
        label="Logout reminder"
        hint="IST. Anyone with a login today and no logout since gets a nudge."
        error={fieldErrors.logoutReminderTime}
      >
        {(control) => (
          <Input
            {...control}
            name="logoutReminderTime"
            type="time"
            defaultValue={thresholds.logoutReminderTime}
            className="max-w-40"
            required
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Acknowledgement reminder (hours)"
          hint="How often an assignee who hasn't noted a task is reminded."
          error={fieldErrors.ackRepeatHours}
        >
          {(control) => (
            <Input
              {...control}
              name="ackRepeatHours"
              type="number"
              inputMode="numeric"
              min={1}
              max={240}
              defaultValue={thresholds.ackRepeatHours}
              required
            />
          )}
        </FormField>
        <FormField
          label="Escalate to the Admin after (hours)"
          hint="Level 1: the approving Admin, or the creator."
          error={fieldErrors.ackEscalateHours}
        >
          {(control) => (
            <Input
              {...control}
              name="ackEscalateHours"
              type="number"
              inputMode="numeric"
              min={1}
              max={240}
              defaultValue={thresholds.ackEscalateHours}
              required
            />
          )}
        </FormField>
        <FormField
          label="Escalate to the Owner after (hours)"
          hint="Level 2, so never sooner than the Admin escalation."
          error={fieldErrors.ackEscalateOwnerHours}
        >
          {(control) => (
            <Input
              {...control}
              name="ackEscalateOwnerHours"
              type="number"
              inputMode="numeric"
              min={1}
              max={240}
              defaultValue={thresholds.ackEscalateOwnerHours}
              required
            />
          )}
        </FormField>
        <FormField
          label="Overdue escalation (hours)"
          hint="Past the deadline with nothing submitted: the Admin and the Owner."
          error={fieldErrors.overdueEscalateHours}
        >
          {(control) => (
            <Input
              {...control}
              name="overdueEscalateHours"
              type="number"
              inputMode="numeric"
              min={1}
              max={240}
              defaultValue={thresholds.overdueEscalateHours}
              required
            />
          )}
        </FormField>
        <FormField
          label="Email cap per person per day"
          hint="Invites, email changes and escalations are sent anyway."
          error={fieldErrors.emailDailyCapPerMember}
        >
          {(control) => (
            <Input
              {...control}
              name="emailDailyCapPerMember"
              type="number"
              inputMode="numeric"
              min={0}
              max={200}
              defaultValue={thresholds.emailDailyCapPerMember}
              required
            />
          )}
        </FormField>
      </div>

      <StickyActions>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save thresholds"}
        </Button>
      </StickyActions>
    </form>
  );
}
