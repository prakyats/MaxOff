"use client";

import type { ComponentProps } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

import type { ConfirmDialog } from "./confirm-dialog";

const loadConfirmDialog = () => import("./confirm-dialog").then((module) => module.ConfirmDialog);

/**
 * `ConfirmDialog` **loaded after the page** (6.0, the first-load diet; ARCHITECTURE §19), for a
 * screen whose first load is budgeted (My Day, Today): the dialog draws nothing until it is
 * opened, so the alert dialog's code stays out of the first load. Same props; opened before the
 * code has arrived, it opens as soon as it does.
 */
export function ConfirmDialogLazy(props: ComponentProps<typeof ConfirmDialog>) {
  return <AfterPage load={loadConfirmDialog} props={props} />;
}
