"use client";

import dynamic from "next/dynamic";

import { useFollowUp } from "@/core/ui/composites/follow-up";

import type { ClaimSetup } from "../domain/claims";

/**
 * The claim form behind End day's "Any expenses to claim today?" → **Yes** (PRODUCT §4.18,
 * decision 21). End day (`modules/attendance`) renders this node and opens it once the day has
 * ended; it takes several claims for that day until **Done**. Loaded only when it opens: the
 * strip sits on My Day and /today, which hold a first-load budget.
 */
const ExpenseClaimDialog = dynamic(
  () => import("./expense-claim-dialog").then((module) => module.ExpenseClaimDialog),
  { ssr: false },
);

export function EndDayClaims({
  today,
  setup,
}: {
  today: string;
  setup: Promise<ClaimSetup | null>;
}) {
  const followUp = useFollowUp();
  if (!followUp?.open) return null;
  return (
    <ExpenseClaimDialog
      today={today}
      date={followUp.date}
      setup={setup}
      several
      onClose={() => followUp.onOpenChange(false)}
    />
  );
}
