"use client";

import { createContext, useState } from "react";

/**
 * Which opening of a modal this is. Radix gives a modal's overlay and its content a portal each,
 * with their own exit animations (the overlay fades out in 100 ms; the sheet slides out in 200 ms
 * on a phone). Reopened while the content is still animating out (back, back on "Discard?", or a
 * slow phone), Radix keeps the content's portal and mounts a new overlay portal after it, so the
 * overlay covers its own sheet: blurred, and no button takes a tap (found by the 4B review's back
 * spec at 430px). `Dialog`, `AlertDialog` and `Sheet` key their portals by the opening, so every
 * opening gets a fresh pair, overlay first; a close still plays its exit animation.
 */
export const ModalOpening = createContext(0);

/** Counts the openings: the value changes on the render that opens, never on a close. */
export function useModalOpening(open: boolean): number {
  const [seen, setSeen] = useState(() => ({ open, count: open ? 1 : 0 }));
  if (seen.open !== open) {
    const next = { open, count: open ? seen.count + 1 : seen.count };
    // Derived from the previous render (React's "storing information from previous renders").
    setSeen(next);
    return next.count;
  }
  return seen.count;
}
