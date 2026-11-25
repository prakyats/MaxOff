"use client";

import { useEffect } from "react";

/** The address the Revenue page's lines and the "not priced" notification open: `…#project-billing`. */
export const BILLING_ANCHOR = "project-billing";

/**
 * Brings the Billing section into view when the page was opened at `#project-billing` (v2.5). The
 * browser's own jump to an anchor happens when the document loads, before this section has streamed
 * in, so on a phone the Owner landed at the top of a long project page. This runs once, when the
 * section appears, and only for that address: it adds no history entry and never moves a page the
 * Owner opened any other way.
 */
export function BillingArrival() {
  useEffect(() => {
    if (window.location.hash !== `#${BILLING_ANCHOR}`) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(BILLING_ANCHOR)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}
