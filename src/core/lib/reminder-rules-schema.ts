import { z } from "zod";

import {
  REMINDER_MAX_MINUTES,
  REMINDER_MESSAGES,
  REMINDER_UNITS,
  reminderMinutes,
  REMINDERS_MAX,
} from "./reminder-rules";

/**
 * The reminder rule list as the actions take it (5.3): `app.reminder_rules_valid` in zod, with a
 * message on the field that is wrong. Imported by the modules' `domain/schemas.ts` (server
 * actions) only; the browser checks rows with `reminderRowErrors` in `reminder-rules.ts`, which
 * carries no zod (a client bundle would grow by ~400 KB).
 */
export const reminderRuleSchema = z
  .object({
    before: z
      .number({ error: REMINDER_MESSAGES.whole })
      .int(REMINDER_MESSAGES.whole)
      .min(0, REMINDER_MESSAGES.whole),
    unit: z.enum(REMINDER_UNITS, { error: "Pick minutes, hours or days." }),
  })
  .strict()
  .refine((rule) => reminderMinutes(rule) <= REMINDER_MAX_MINUTES, {
    path: ["before"],
    message: REMINDER_MESSAGES.tooFar,
  });

/** A whole list, as `app.reminder_rules_valid` takes it. `[]` = "use the next level". */
export const reminderRulesSchema = z
  .array(reminderRuleSchema)
  .max(REMINDERS_MAX, REMINDER_MESSAGES.tooMany)
  .superRefine((rules, context) => {
    const seen = new Set<number>();
    rules.forEach((rule, index) => {
      const minutes = reminderMinutes(rule);
      if (seen.has(minutes)) {
        context.addIssue({
          code: "custom",
          path: [index, "before"],
          message: REMINDER_MESSAGES.same,
        });
      }
      seen.add(minutes);
    });
  });
