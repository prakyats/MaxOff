"use client";

import { useEffect } from "react";

/**
 * Marks the signed-in shell as hydrated: `data-chrome="shown"` on `<html>` once the app's
 * JavaScript runs. It renders nothing. (It used to drive the phone's brand bar, which slid away on
 * scroll; since L4 a phone has one header bar, the page's own, and nothing slides.) The attribute
 * stays because the navigation progress (`core/ui/navigation/progress.ts`) and the e2e helpers
 * (`hydrated`) read it as "the shell's taps are live".
 */
export function MobileChrome() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.chrome = "shown";
    return () => {
      delete root.dataset.chrome;
    };
  }, []);

  return null;
}
