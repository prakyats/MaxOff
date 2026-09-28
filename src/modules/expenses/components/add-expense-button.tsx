"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import type { ClaimSetup } from "../domain/claims";

/** The claim form (a select, a photo picker and the upload code) loads when it first opens. */
const ExpenseClaimDialog = dynamic(
  () => import("./expense-claim-dialog").then((module) => module.ExpenseClaimDialog),
  { ssr: false },
);

/** Add expense, on the member's Expenses tab (3b.3): opens the claim form for one claim. */
export function AddExpenseButton({
  today,
  setup,
}: {
  today: string;
  setup: Promise<ClaimSetup | null>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-slot="add-expense">
        Add expense
      </Button>
      {open ? (
        <ExpenseClaimDialog today={today} setup={setup} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
