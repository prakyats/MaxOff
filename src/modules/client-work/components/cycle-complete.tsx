"use client";

import { useEffect, useState } from "react";

import { celebratedKey, celebrateNow } from "../domain/progress";

function seenOn(cycleId: string): string | null {
  try {
    return window.localStorage.getItem(celebratedKey(cycleId));
  } catch {
    return null;
  }
}

function remember(cycleId: string): void {
  try {
    window.localStorage.setItem(celebratedKey(cycleId), "1");
  } catch {
    // Storage is unavailable (a private window, blocked site data): the moment simply may repeat.
  }
}

/**
 * The 100% moment (6b.11 (5)): "October 2026 complete" with a check that pops in **once per cycle
 * per device** (a note in this browser's storage; nothing is stored on the server), static under
 * reduced motion. The words stay whenever the cycle is complete; only the animation is once.
 * `data-celebrated` says which it was ("now" or "before") once the page has hydrated.
 */
export function CycleCompleteMoment({ cycleId, words }: { cycleId: string; words: string }) {
  const [played, setPlayed] = useState<"now" | "before" | null>(null);
  // The check's entrance: undrawn first, then drawn on the next frame (a transition, so reduced
  // motion simply skips it).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const now = celebrateNow(true, seenOn(cycleId));
    if (now) remember(cycleId);
    // Read after mount only: the server's HTML cannot know this device's note.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the note lives in this browser only
    setPlayed(now ? "now" : "before");
    if (!now) return;
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [cycleId]);
  return (
    <span
      data-slot="cycle-complete"
      data-celebrated={played ?? undefined}
      className="text-success inline-flex items-center gap-1.5 text-sm font-medium"
    >
      {/* The check draws itself in (a stroke, not a transform: it stays on the page's own paint,
          beside any open layer), static under reduced motion. */}
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 shrink-0" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        <path
          d="m8 12.5 2.8 2.8L16.5 9.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={played === "now" && !entered ? 1 : 0}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700 motion-safe:ease-out"
        />
      </svg>
      {words}
    </span>
  );
}
