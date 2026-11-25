"use client";

import { type ReactNode, useState } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

const loadReveal = () =>
  import("./today-revenue-reveal").then((module) => module.TodayRevenueReveal);

/**
 * The Today line's tap (v2.5 review): the part that reads and shows the figures is **loaded after
 * the page** (ARCHITECTURE §19, `AfterPage`), so `/today`'s first load carries only this wrapper.
 * The masked button (`children`) and the loading bar (`loading`) are drawn on the server and
 * handed in, so no code of theirs is in the first load either. A tap before the loaded part is in
 * shows the loading bar, and the figures are asked for as soon as it arrives (`startShown`).
 */
export function TodayRevenueShow({
  masked,
  loading,
  children,
}: {
  masked: string;
  loading: ReactNode;
  children: ReactNode;
}) {
  const [wanted, setWanted] = useState(false);
  return (
    <AfterPage
      load={loadReveal}
      props={{ masked, startShown: wanted }}
      fallback={
        wanted ? (
          loading
        ) : (
          // pressable: none, not a control: it only hears the tap of the masked button inside it.
          <div className="contents" onClick={() => setWanted(true)}>
            {children}
          </div>
        )
      }
    />
  );
}
