"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { useAction } from "@/core/ui/action/use-action";
import { AfterPage } from "@/core/ui/lazy/after-page";
import { Button } from "@/core/ui/primitives/button";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { toastResult } from "@/core/ui/toast";

import { clearStayPlan } from "../actions/hours";

import type { StayPlanSheet, StayPlanTarget } from "./stay-plan-sheet";

const loadSheet = () => import("./stay-plan-sheet").then((module) => module.StayPlanSheet);

/** One plan as the card shows it: the words are the server's (no clock on hydration). */
export type StayPlanRow = {
  id: string;
  workDate: string;
  /** "Fri 28 Nov · until 8:00 pm". */
  line: string;
  /** "Fri 28 Nov", for the toast. */
  day: string;
  /** The time it ends, `HH:MM` (IST), for Change. */
  until: string;
  /** "Not used: on leave": an approved leave covers the date. */
  onLeave: boolean;
};

/**
 * "Stay until, coming up" on a person's page (v7.0; the approved sample
 * `docs/design/v70-clear-late-sample.html` screen 4; WORKFLOWS §1): the Owner's Stay until set
 * ahead for this person, today on, each with **Change** (the sheet, prefilled) and **Back to
 * 6:00 pm** (cleared, kept; they are told), and **Stay until…** for a new date. Only the Owner
 * (`attendance.decide`); a day already started is changed from Today's attendance, as before.
 */
export function StayPlansCard({
  memberId,
  name,
  workEnd,
  workEndWords,
  today,
  plans,
}: {
  memberId: string;
  name: string;
  /** `org_settings.work_end_time`, `HH:MM`. */
  workEnd: string;
  /** "6:00 pm": the end time in words, for "Back to 6:00 pm". */
  workEndWords: string;
  today: string;
  plans: StayPlanRow[];
}) {
  const [target, setTarget] = useState<StayPlanTarget | null>(null);
  const base = { memberId, name, workEnd, today };
  return (
    <section
      aria-labelledby="stay-plans-heading"
      data-slot="stay-plans"
      className="flex flex-col gap-3"
    >
      <Card>
        <CardContent className="flex flex-col gap-3 text-sm">
          <h2 id="stay-plans-heading" className="font-medium">
            Stay until, coming up
          </h2>
          {plans.length === 0 ? (
            <p data-slot="stay-plans-empty" className="text-muted-foreground">
              Nothing set ahead. Their day ends at {workEndWords}.
            </p>
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {plans.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  name={name}
                  workEndWords={workEndWords}
                  onChange={() =>
                    setTarget({ ...base, workDate: plan.workDate, until: plan.until })
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {/* pending: none: it opens the sheet, whose "Set Stay until" commits. */}
      <Button
        variant="primary"
        opens
        className="w-full md:w-auto md:self-start"
        onClick={() => setTarget({ ...base, workDate: null, until: null })}
        data-slot="stay-plan-open"
      >
        Stay until…
      </Button>
      <AfterPage<React.ComponentProps<typeof StayPlanSheet>>
        load={loadSheet}
        props={{ target, onOpenChange: (open) => (open ? null : setTarget(null)) }}
      />
    </section>
  );
}

function PlanRow({
  plan,
  name,
  workEndWords,
  onChange,
}: {
  plan: StayPlanRow;
  name: string;
  workEndWords: string;
  onChange: () => void;
}) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const back = useAction(async () => {
    const result = await clearStayPlan({ planId: plan.id });
    if (toastResult(result, { success: `${name}'s day ends at ${workEndWords} on ${plan.day}` })) {
      setDone(true);
      router.refresh();
    }
  });
  const busy = back.pending || done;
  return (
    <li
      data-slot="stay-plan"
      data-date={plan.workDate}
      className={cn(
        "flex flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:gap-4",
        done && "opacity-50",
      )}
    >
      <div className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span data-slot="stay-plan-line" className="break-words">
            {plan.line}
          </span>
          {plan.onLeave ? (
            <span data-slot="stay-plan-on-leave" className="text-muted-foreground text-xs">
              Not used: on leave
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          className="shrink-0"
          disabled={busy}
          onClick={onChange}
          data-slot="stay-plan-change"
        >
          Change
        </Button>
      </div>
      <Button
        variant="secondary"
        commits
        className="w-full md:w-auto"
        pending={back.pending}
        pendingLabel="Clearing…"
        disabled={busy}
        onClick={() => back.run()}
        data-slot="stay-plan-clear"
      >
        Back to {workEndWords}
      </Button>
    </li>
  );
}
