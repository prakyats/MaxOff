"use client";

import { useLayoutEffect } from "react";

import { HYDRATED_ATTRIBUTE } from "./attributes";

/**
 * Marks the document hydrated (`html[data-hydrated]`), in the root layout on every screen. From
 * then on the app's own handlers answer taps and the pre-hydration script steps aside. A layout
 * effect, so the mark is set in the same commit as hydration: no click can land between the two.
 * `scripts/measure-hydration.mjs` and the e2e `hydrated()` helper wait for it too.
 */
export function HydratedMark() {
  useLayoutEffect(() => {
    document.documentElement.setAttribute(HYDRATED_ATTRIBUTE, "");
  }, []);
  return null;
}
