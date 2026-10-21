import Link from "next/link";

/**
 * The small MaxOff mark at the top-left of a phone's header bar on a top-level tab (owner
 * 2026-10-21, v1.8 V4): Today, Approvals, Tasks, Calendar and the More destinations. A tap goes
 * home (`/`, which the proxy answers with the viewer's home: Today, or My Day for the Crew)
 * **by replace**, so it adds no history entry (§14.2). A drill-down keeps its back arrow in this
 * spot instead (`PageHeader`). Phone only: a laptop has the sidebar's wordmark.
 */
export function HomeMark() {
  return (
    <Link
      href="/"
      replace
      prefetch={false}
      aria-label="MaxOff, go to your home screen"
      data-slot="home-mark"
      className="pressable focus-visible:ring-ring -ml-1 flex size-11 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2 md:hidden"
    >
      <span
        aria-hidden
        className="bg-logo text-logo-foreground flex size-7 items-center justify-center rounded-md text-xs font-semibold"
      >
        M
      </span>
    </Link>
  );
}
