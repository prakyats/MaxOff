/**
 * The nav count's markup (2.4; 4C), one place for every spot that draws it: the bottom bar's
 * icon (`bar`: a small disc punched out of the icon, with the words for a screen reader beside
 * the label), the sidebar (`list`) and the More sheet (`sheet`). Plain markup, no state: the
 * server streams it (`NavCount`) and the client bars place it.
 */

export type NavBadgePlace = "bar" | "bell" | "topbar" | "list" | "sheet";

const BELL_PILL =
  "bg-brand text-brand-foreground ring-background absolute top-0 left-full flex h-4 min-w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-1 text-count font-semibold ring-2";

const CLASSES: Record<NavBadgePlace, string> = {
  // The ring punches the badge out of the icon so it stays readable over either.
  bar: "bg-brand text-brand-foreground ring-background absolute -top-0.5 right-1.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-xs leading-none font-semibold ring-2",
  // The bell's count, on the phone's title bar (`bell`) and the laptop's top bar (`topbar`): owner
  // screenshot, #89 comment 6338991185 (the 18 px disc crowded the theme icon). A 16 px pill with
  // 11 px semibold text (`text-count`, DESIGN §2), at least 16 px wide so one digit makes a
  // circle, capped at "99+". Its centre sits on the 20 px glyph's top-right corner (placed against
  // the glyph's own box, not the 44 px button's): about a quarter of it over the glyph, the rest
  // outside. The 2 px ring is the bar's background, so it reads punched out in either theme.
  bell: BELL_PILL,
  topbar: BELL_PILL,
  list: "bg-brand text-brand-foreground ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs leading-none font-semibold tabular-nums",
  sheet:
    "bg-brand text-brand-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
};

function shown(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** The visible count; nothing for zero. In the bar it is decoration: `NavBadgeWords` speaks. */
export function NavBadgeMark({ count, place }: { count: number; place: NavBadgePlace }) {
  if (count <= 0) return null;
  if (place === "bar" || place === "bell" || place === "topbar") {
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
