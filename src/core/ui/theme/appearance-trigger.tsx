"use client";

import dynamic from "next/dynamic";
import { type ComponentProps, useState } from "react";

import { cn } from "@/core/lib/utils";

/** The sheet's code arrives on the first tap and stays (ARCHITECTURE §19). */
const AppearanceSheet = dynamic(
  () => import("./appearance-sheet").then((module) => module.AppearanceSheet),
  { ssr: false },
);

/**
 * What opens the phone's Appearance sheet (v2.0 X1b): any button look, given as `children`
 * (the More sheet's whole "Appearance · Dark" row, Me's icon button). A tap before the sheet's
 * code has arrived opens it as soon as it is there.
 */
export function AppearanceTrigger({
  children,
  className,
  ...props
}: Omit<ComponentProps<"button">, "onClick" | "type">) {
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-slot="appearance-trigger"
        {...props}
        className={cn("pressable-row", className)}
        onClick={() => {
          setUsed(true);
          setOpen(true);
        }}
      >
        {children}
      </button>
      {used ? <AppearanceSheet open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
