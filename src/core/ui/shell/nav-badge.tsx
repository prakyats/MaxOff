/**
 * The nav count's markup (2.4; 4C), one place for every spot that draws it: the bottom bar's
 * icon (`bar`: a small disc punched out of the icon, with the words for a screen reader beside
 * the label), the sidebar (`list`) and the More sheet (`sheet`). Plain markup, no state: the
 * server streams it (`NavCount`) and the client bars place it.
 */

export type NavBadgePlace = "bar" | "bell" | "list" | "sheet";

const CLASSES: Record<NavBadgePlace, string> = {
  // The ring punches the badge out of the icon so it stays readable over either.
  bar: "bg-brand text-brand-foreground ring-background absolute -top-0.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold ring-2",
  // The title bar's bell (owner 2026-10-07): the same disc, kept inside the bell's 44px box. The
  // bar's offset sits above its 28px pill, with the tab's own height around it; on the bell it
  // reached 2px above the sticky title bar, which the brand bar above then cut off. Inside the
  // box (top 4px, right 4px) it overlaps the bell's top-right corner, as a count should, and
  // "99+" (about 26px wide) still ends 4px short of the box's right edge.
  bell: "bg-brand text-brand-foreground ring-background absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold ring-2",
  list: "bg-brand text-brand-foreground ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold tabular-nums",
  sheet:
    "bg-brand text-brand-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
};

function shown(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** The visible count; nothing for zero. In the bar it is decoration: `NavBadgeWords` speaks. */
export function NavBadgeMark({ count, place }: { count: number; place: NavBadgePlace }) {
  if (count <= 0) return null;
  if (place === "bar" || place === "bell") {
    return (
      <span data-slot="nav-badge" className={CLASSES[place]}>
        {shown(count)}
      </span>
    );
  }
  return (
    <span data-slot="nav-badge" className={CLASSES[place]}>
      <span aria-hidden>{shown(count)}</span>
      <span className="sr-only"> {count} waiting</span>
    </span>
  );
}

/** What a screen reader hears after the bar's label: "Tasks 2 waiting". */
export function NavBadgeWords({ count }: { count: number }) {
  return count > 0 ? <span className="sr-only">{count} waiting</span> : null;
}
