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
 * The timings that drive reminders and escalations (PRODUCT §7, WORKFLOWS §9), and the workload
 * warning the task dialog shows (4.3, kickoff 4 decision 11). The reminder jobs arrive with 5.3.
 * Changing one never rewrites what already happened — each job reads the value when it runs.
 */
export function ThresholdsForm({ thresholds }: { thresholds: Thresholds }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<null> | null, formData: FormData) => {
      const value = (name: string) => String(formData.get(name) ?? "");
      const result = await updateThresholds({
        logoutReminderTime: value("logoutReminderTime"),
        endDayCutoffTime: value("endDayCutoffTime"),
        ackRepeatHours: value("ackRepeatHours"),
        ackEscalateHours: value("ackEscalateHours"),
        ackEscalateOwnerHours: value("ackEscalateOwnerHours"),
        overdueEscalateHours: value("overdueEscalateHours"),
        emailDailyCapPerMember: value("emailDailyCapPerMember"),
        workloadWarningThreshold: value("workloadWarningThreshold"),
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
        label="End-of-day reminder"
        hint="IST. Anyone who started their day and hasn't ended it gets a nudge: end it, or carry on."
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
      <FormField
        label="Late End day until"
        hint="IST, the next morning. Until then a day left open can still be ended; after it, it stays “End of day not recorded” and late work goes in an overtime note."
        error={fieldErrors.endDayCutoffTime}
      >
        {(control) => (
          <Input
            {...control}
            name="endDayCutoffTime"
            type="time"
            defaultValue={thresholds.endDayCutoffTime}
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
        <FormField
          label="Workload warning (tasks due that day)"
          hint="Assigning someone who already has this many open tasks due that day shows a warning. It never blocks."
          error={fieldErrors.workloadWarningThreshold}
        >
          {(control) => (
            <Input
              {...control}
              name="workloadWarningThreshold"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              defaultValue={thresholds.workloadWarningThreshold}
              required
            />
          )}
        </FormField>
      </div>

      <StickyActions>
        <Button variant="primary" type="submit" pending={pending} pendingLabel="Saving…">
          Save thresholds
        </Button>
      </StickyActions>
    </form>
  );
}
