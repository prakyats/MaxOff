"use client";

import type { ComponentProps } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

import type { HandinAdder } from "./handin-adder";
import type { HandinDoneLine } from "./handin-done-line";

const loadAdder = () => import("./handin-adder").then((module) => module.HandinAdder);
const loadDoneLine = () => import("./handin-done-line").then((module) => module.HandinDoneLine);

/**
 * The hand-in's interactive parts **loaded after the page** (ARCHITECTURE §19, the first-load
 * diet; `/tasks/[id]`'s budget is never raised): the add area with the upload engine, and Mark
 * done's line. Until the add area's code is in, its own button stands in (it opens nothing yet).
 */
export function HandinAdderLazy(props: ComponentProps<typeof HandinAdder>) {
  return (
    <AfterPage
      load={loadAdder}
      props={props}
      fallback={
        <div className="flex min-h-11 items-center" data-slot="handin-adder-pending">
          <span className="text-muted-foreground text-sm">Getting the uploader ready…</span>
        </div>
      }
    />
  );
}

export function HandinDoneLineLazy(props: ComponentProps<typeof HandinDoneLine>) {
  return <AfterPage load={loadDoneLine} props={props} />;
}
