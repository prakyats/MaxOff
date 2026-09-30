import { badgeTotal, type NavBadges } from "./nav";
import { NavBadgeMark, type NavBadgePlace, NavBadgeWords } from "./nav-badge";

/**
 * One nav count, streamed (4C): the layout hands the shell a promise of the viewer's counts and
 * never waits for it, so the shell and the page's loading screen paint first and each count lands
 * in its own `<Suspense>` when the reads answer (ARCHITECTURE §19: a slow part streams, the rest
 * never waits for it). A server component: it adds nothing to the shell's JavaScript. `keys` are
 * added up (the More cell counts what hides behind it).
 */
export async function NavCount({
  counts,
  keys,
  place,
  part = "mark",
}: {
  counts: Promise<NavBadges>;
  keys: readonly string[];
  place: NavBadgePlace;
  /** The bar draws the disc on the icon and the words after the label: two parts. */
  part?: "mark" | "words";
}) {
  const count = badgeTotal(await counts, keys);
  return part === "words" ? (
    <NavBadgeWords count={count} />
  ) : (
    <NavBadgeMark count={count} place={place} />
  );
}
