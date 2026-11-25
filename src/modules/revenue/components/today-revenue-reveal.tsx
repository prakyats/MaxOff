"use client";

import { useEffect, useRef, useState } from "react";

import { getInBackground } from "@/core/http/background";

import { type MonthTotals, todayRevenueLine } from "../domain/today";

import { TODAY_REVENUE_TEXT, TodayRevenueLoading, TodayRevenueToggle } from "./today-revenue-parts";

type View =
  | { kind: "masked" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "shown"; totals: MonthTotals }
  | { kind: "hidden"; totals: MonthTotals };

/**
 * The Today line's figures, read on the Owner's tap (v2.5 review; loaded after the page by
 * `TodayRevenueShow`). The first tap reads the month's totals **once**
 * (`GET /api/revenue/month-totals`, `finance.view`, never cached) with a loading bar in the line's
 * box; a second tap masks them again and a third shows them without another request. A view
 * control: no history entry, nothing kept (a reload starts masked). A read that fails says so in
 * the same box, muted, beside "Open Revenue"; no amount is in any message.
 */
export function TodayRevenueReveal({
  masked,
  startShown,
}: {
  masked: string;
  /** The stand-in was tapped before this code arrived: read straight away. */
  startShown: boolean;
}) {
  const [view, setView] = useState<View>(startShown ? { kind: "loading" } : { kind: "masked" });
  const asked = useRef(false);

  const read = () => {
    if (asked.current) return;
    asked.current = true;
    setView({ kind: "loading" });
    void getInBackground<MonthTotals>("/api/revenue/month-totals").then((result) => {
      setView(result.ok ? { kind: "shown", totals: result.data } : { kind: "failed" });
    });
  };

  useEffect(() => {
    if (startShown) read();
    // Once, on arrival: `startShown` is the tap that came before this code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view.kind === "loading") return <TodayRevenueLoading />;
  if (view.kind === "failed") {
    return (
      <p
        className={`${TODAY_REVENUE_TEXT} text-muted-foreground break-words`}
        role="status"
        data-slot="today-revenue-failed"
      >
        Revenue couldn&apos;t load ·
      </p>
    );
  }
  if (view.kind === "shown") {
    return (
      <TodayRevenueToggle
        words={todayRevenueLine(view.totals, { masked: false })}
        shown
        onPress={() => setView({ kind: "hidden", totals: view.totals })}
      />
    );
  }
  return (
    <TodayRevenueToggle
      words={masked}
      shown={false}
      onPress={() =>
        view.kind === "hidden" ? setView({ kind: "shown", totals: view.totals }) : read()
      }
    />
  );
}
