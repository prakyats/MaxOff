"use client";

import type { ComponentProps } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

import type { AskLeaveEarlySheet, LateSheet } from "./hours-sheets";

const loadLate = () => import("./hours-sheets").then((module) => module.LateSheet);
const loadAsk = () => import("./hours-sheets").then((module) => module.AskLeaveEarlySheet);

/**
 * The working-hours sheets **loaded after the page** (ARCHITECTURE §19; v1.9 W4): the strip sits on
 * My Day and Today, which hold a first-load budget. Opened before the code has arrived, a sheet
 * opens as soon as it does.
 */
export function LateSheetLazy(props: ComponentProps<typeof LateSheet>) {
  return <AfterPage load={loadLate} props={props} />;
}

export function AskLeaveEarlySheetLazy(props: ComponentProps<typeof AskLeaveEarlySheet>) {
  return <AfterPage load={loadAsk} props={props} />;
}
