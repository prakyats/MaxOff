"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ReviewSheet } from "@/core/ui/composites/review-sheet";
import { HistoryButton } from "@/core/ui/composites/history-button";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";

/**
 * The trigger and the sheet with `children` (the history, rendered by the page). An old link that
 * asked for the history as a view (`?tab=activity`, `?history=1`) opens the sheet on arrival; the
 * address drops the parameter first (replaced, no history), so back from the sheet leaves a clean
 * page address behind.
 */
export function HistorySheet({
  description,
  arrival,
  children,
}: {
  description?: string;
  /** The query parameters (name → value) that open it on arrival. */
  arrival?: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!arrival) return;
    const url = new URL(window.location.href);
    const asked = Object.entries(arrival).filter(
      ([key, value]) => url.searchParams.get(key) === value,
    );
    if (asked.length === 0) return;
    for (const [key] of asked) url.searchParams.delete(key);
    replaceViewAddress(`${url.pathname}${url.search}${url.hash}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opened once, on arrival from an old link
    setOpen(true);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <HistoryButton onOpen={() => setOpen(true)} />
      <ReviewSheet open={open} onOpenChange={setOpen} title="History" description={description}>
        <div data-slot="history-sheet">{children}</div>
      </ReviewSheet>
    </>
  );
}
