"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors";
import {
  draftFromRules,
  LAUNCH_REMINDERS,
  type ReminderDraft,
  rulesFromDraft,
} from "@/core/lib/reminder-rules";
import { FormField } from "@/core/ui/composites/form-field";
import { ReminderRulesEditor } from "@/core/ui/composites/reminder-rules-editor";
import { StickyActions } from "@/core/ui/composites/sticky-actions";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { isWeekdayIndex, type WeekdayIndex } from "@/core/time";

import { updateThresholds } from "../actions/settings";
import type { UpdateThresholdsInput } from "../domain/schemas";
import { type Thresholds, weeklyDigestChoices } from "../domain/settings";
import { FormError } from "./form-error";

/**
 * The timings that drive reminders and escalations (PRODUCT §7, WORKFLOWS §9), and the workload
 * warning the task dialog shows (4.3, kickoff 4 decision 11), and the Owner's quiet hours (5B
 * decision 6), and the organisation's default task reminders (5.3: the level under every type and
 * template; "Using the default" while empty, which is the launch schedule).
 * Changing one never rewrites what already happened — each job reads the value when it runs; a
 * task's reminders are worked out when it is created or its deadline moves.
 */
export function ThresholdsForm({ thresholds }: { thresholds: Thresholds }) {
  const [reminders, setReminders] = useState<ReminderDraft>(() =>
    draftFromRules(thresholds.defaultTaskReminders),
  );
  const [remindersBlocked, setRemindersBlocked] = useState(false);
  const [digestDay, setDigestDay] = useState<WeekdayIndex>(thresholds.weeklyDigestDay);
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
        quietHoursStart: value("quietHoursStart"),
        quietHoursEnd: value("quietHoursEnd"),
        defaultTaskReminders: readList(value("defaultTaskReminders")),
        weeklyDigestDay: value("weeklyDigestDay"),
      });
      if (result.ok) toast.success("Thresholds saved");
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;
  // Submitted through onSubmit, not the form's `action`: React resets a form's uncontrolled
  // fields after an `action` runs, failures included, so a refused save (a field error) used to
  // put every other edit back to the saved value, and the next Save stored what nobody typed.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A reminder row that needs fixing says so under itself; nothing is sent until it is fixed.
    if (rulesFromDraft(reminders) === null) {
      setRemindersBlocked(true);
      return;
    }
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }
  const fieldErrors = error?.fieldErrors ?? {};
  const remindersError =
    Object.entries(fieldErrors).find(([key]) => key.startsWith("defaultTaskReminders"))?.[1]?.[0] ??
    (remindersBlocked && rulesFromDraft(reminders) === null
      ? "Fix the reminders, or use the default."
      : undefined);

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
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

      <section aria-labelledby="quiet-hours" className="flex flex-col gap-3">
        <div>
          <h2 id="quiet-hours" className="text-sm font-medium">
            Quiet hours
          </h2>
          <p className="text-muted-foreground text-sm">
            IST, for everyone. Notifications that arrive in these hours wait and come as one summary
            when they end. Emails and the in-app list aren&apos;t held, and a test notification
            ignores them.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Quiet from" error={fieldErrors.quietHoursStart}>
            {(control) => (
              <Input
                {...control}
                name="quietHoursStart"
                type="time"
                defaultValue={thresholds.quietHoursStart}
                className="max-w-40"
                required
              />
            )}
          </FormField>
          <FormField
            label="Quiet until"
            hint="The next morning when it is earlier than the start."
            error={fieldErrors.quietHoursEnd}
          >
            {(control) => (
              <Input
                {...control}
                name="quietHoursEnd"
                type="time"
                defaultValue={thresholds.quietHoursEnd}
                className="max-w-40"
                required
              />
            )}
          </FormField>
        </div>
      </section>

      <section aria-labelledby="weekly-summary" className="flex flex-col gap-3">
        <div>
          <h2 id="weekly-summary" className="text-sm font-medium">
            Weekly summary
          </h2>
          <p className="text-muted-foreground text-sm">
            Your week by email, built from the saved end-of-day reports: at 8:00 AM on this day, or
            as soon as the last day&apos;s report is saved if that is later.
          </p>
        </div>
        <FormField label="Sent on" error={fieldErrors.weeklyDigestDay}>
          {(control) => (
            <Select
              value={String(digestDay)}
              onValueChange={(next) => {
                const day = Number(next);
                if (isWeekdayIndex(day)) setDigestDay(day);
              }}
            >
              <SelectTrigger
                id={control.id}
                className="max-w-60"
                aria-describedby={control["aria-describedby"]}
                aria-invalid={control["aria-invalid"]}
                data-slot="weekly-digest-day"
              >
                <SelectValue placeholder="Choose a day" />
              </SelectTrigger>
              <SelectContent>
                {weeklyDigestChoices(digestDay).map((choice) => (
                  <SelectItem key={choice.value} value={String(choice.value)}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <input type="hidden" name="weeklyDigestDay" value={digestDay} />
      </section>

      <section aria-labelledby="default-reminders" className="flex flex-col gap-3">
        <div>
          <h2 id="default-reminders" className="text-sm font-medium">
            Default reminders
          </h2>
          <p className="text-muted-foreground text-sm">
            Before a task&apos;s deadline, for every task whose type and template have none of their
            own. The overdue reminder and the escalations are fixed.
          </p>
        </div>
        <ReminderRulesEditor
          draft={reminders}
          onChange={(next) => {
            setReminders(next);
            setRemindersBlocked(false);
          }}
          fallback={LAUNCH_REMINDERS}
          disabled={pending}
          error={remindersError}
        />
        <input
          type="hidden"
          name="defaultTaskReminders"
          value={JSON.stringify(rulesFromDraft(reminders) ?? [])}
        />
      </section>

      <StickyActions>
        <Button variant="primary" type="submit" pending={pending} pendingLabel="Saving…">
          Save thresholds
        </Button>
      </StickyActions>
    </form>
  );
}

/** The hidden field's list: written by this form from a checked draft; the action checks again. */
function readList(text: string): UpdateThresholdsInput["defaultTaskReminders"] {
  return JSON.parse(text) as UpdateThresholdsInput["defaultTaskReminders"];
}
