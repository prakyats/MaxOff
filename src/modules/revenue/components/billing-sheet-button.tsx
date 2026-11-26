"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

import type { BillingSheetRequest } from "./billing-sheets";

/**
 * The billing sheets (their forms, the date field, the actions) load on the first tap
 * (ARCHITECTURE §19): the project page's first load carries only these buttons.
 */
const BillingSheet = dynamic(
  () => import("./billing-sheets").then((module) => module.BillingSheet),
  { ssr: false },
);

/**
 * A control of the Owner's Billing section (9.2): Set amount, Change, Set price, Record advance,
 * Mark returned. A neutral outline trigger; the sheet it opens holds the one solid commit
 * (ADR-0015). Back closes the sheet (the Dialog registers with the overlay history, §14.2).
 */
export function BillingSheetButton({
  label,
  name,
  slot,
  sheet,
}: {
  label: string;
  /** What a screen reader hears when the label alone is not enough ("Change the category"). */
  name?: string | undefined;
  /** The button's `data-slot`, for the specs. */
  slot: string;
  sheet: BillingSheetRequest;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="shrink-0"
        aria-label={name}
        data-slot={slot}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open ? <BillingSheet request={sheet} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
