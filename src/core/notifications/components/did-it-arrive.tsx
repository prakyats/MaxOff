"use client";

import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";

import { isBrave } from "../push/browser";
import { troubleDeviceOf, troubleshootingFor } from "../push/troubleshooting";

/**
 * "Did it arrive? Yes / No" after a test the push service accepted (task 5.5, owner decision
 * 2026-10-03, 6). The service accepting it already counts as working; this asks the person.
 * **Yes** says so; **No** opens a bottom sheet (a layer: back closes it) with what to check on
 * this phone or browser (`troubleshootingFor`). **Nothing is stored.** Loaded on demand, after a
 * test, so it is never part of a screen's first load.
 */
export function DidItArrive() {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [open, setOpen] = useState(false);

  if (answer === "yes") {
    return (
      <p data-slot="did-it-arrive" data-answer="yes" className="text-sm" aria-live="polite">
        Good: notifications reach you.
      </p>
    );
  }
  return (
    <div
      data-slot="did-it-arrive"
      data-answer={answer ?? undefined}
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <p className="text-sm font-medium">Did it arrive?</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setAnswer("yes")} data-slot="arrived-yes">
          Yes
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setAnswer("no");
            setOpen(true);
          }}
          data-slot="arrived-no"
        >
          No
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          data-slot="troubleshooting-sheet"
          className="max-h-[80dvh] gap-3 overflow-y-auto rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]"
        >
          <div
            aria-hidden
            className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
          />
          {open ? <Steps /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The steps for the device in hand (read only once the sheet opens: it needs the browser). */
function Steps() {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const help = troubleshootingFor(
    troubleDeviceOf({
      userAgent: nav.userAgent,
      maxTouchPoints: nav.maxTouchPoints ?? 0,
      standalone:
        (window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
        nav.standalone === true,
      brave: isBrave(nav),
    }),
  );
  return (
    <>
      <SheetHeader className="pt-3 pb-0">
        <SheetTitle>{help.title}</SheetTitle>
        <SheetDescription>
          The test left MaxOff; something on this device kept it from showing.
        </SheetDescription>
      </SheetHeader>
      <ol
        data-slot="troubleshooting-steps"
        className="flex list-decimal flex-col gap-2 px-4 pl-9 text-sm"
      >
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </>
  );
}
