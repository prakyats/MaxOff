"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import type { ChangeRow } from "../domain/month-close-view";

/**
 * The close screen's one action (v3.5 U4): Close on an open month, Correct on a closed one. Each
 * is the screen's one solid button, neutral (ADR-0015: closing and correcting save a report,
 * they destroy nothing), and it only opens its layer, where the commit is: the confirmation for
 * Close, the differences and the note for Correct. The layers load on the first tap
 * (ARCHITECTURE §19), and back closes them (the Dialog registers with the overlay history, §14.2).
 */
const CloseMonthDialog = dynamic(
  () => import("./month-close-sheets").then((module) => module.CloseMonthDialog),
  { ssr: false },
);
const CorrectMonthDialog = dynamic(
  () => import("./month-close-sheets").then((module) => module.CorrectMonthDialog),
  { ssr: false },
);

export function CloseMonthButton({
  month,
  monthName,
  label,
  waiting,
  confirmLabel,
}: {
  /** The month's first day. */
  month: string;
  /** "September". */
  monthName: string;
  /** "Close September with 4 things still waiting". */
  label: string;
  waiting: number;
  /** "Close September": the confirmation's commit. */
  confirmLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* pending: none — it opens the confirmation, whose own button closes the month. */}
      <Button
        type="button"
        variant="primary"
        opens
        className="min-w-0 whitespace-normal"
        data-slot="month-close-button"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open ? (
        <CloseMonthDialog
          month={month}
          monthName={monthName}
          waiting={waiting}
          confirmLabel={confirmLabel}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function CorrectMonthButton({
  month,
  monthName,
  nextVersion,
  changes,
  totals,
}: {
  month: string;
  monthName: string;
  /** The version a correction would save (latest + 1). */
  nextVersion: number;
  changes: readonly ChangeRow[];
  totals: readonly { key: string; text: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* pending: none — it opens the correction, whose own button saves the new version. */}
      <Button
        type="button"
        variant="primary"
        opens
        data-slot="month-correct-button"
        onClick={() => setOpen(true)}
      >
        Correct {monthName}
      </Button>
      {open ? (
        <CorrectMonthDialog
          month={month}
          monthName={monthName}
          nextVersion={nextVersion}
          changes={changes}
          totals={totals}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
