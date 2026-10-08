import type { ServerUnread } from "@/core/notifications/read-receipts";

import { badgeTotal, type NavBadges } from "./nav";
import { NavBadgeMark, type NavBadgePlace, NavBadgeWords } from "./nav-badge";
import { UnreadNavCount } from "./bell-count";

/** The nav key whose count is the bell's: the member's unread notifications. */
const ALERTS = "alerts";

/**
 * One nav count, streamed (4C): the layout hands the shell a promise of the viewer's counts and
 * never waits for it, so the shell and the page's loading screen paint first and each count lands
 * in its own `<Suspense>` when the reads answer (ARCHITECTURE §19: a slow part streams, the rest
 * never waits for it). A server component: it adds nothing to the shell's JavaScript. `keys` are
 * added up (the More cell counts what hides behind it). A spot that holds the bell's count
 * (`alerts`) is drawn by `UnreadNavCount`, so the member's own reads come off it on the device.
 */
export async function NavCount({
  counts,
  unread,
  keys,
  place,
  part = "mark",
}: {
  counts: Promise<NavBadges>;
  /** The bell's count with the server's clock, for a spot that holds `alerts`. */
  unread?: Promise<ServerUnread | null>;
  keys: readonly string[];
  place: NavBadgePlace;
  /** The bar draws the disc on the icon and the words after the label: two parts. */
  part?: "mark" | "words";
}) {
  const all = await counts;
  const server = unread && keys.includes(ALERTS) ? await unread : null;
  if (server) {
    const others = badgeTotal(
      all,
      keys.filter((key) => key !== ALERTS),
    );
    return (
      <>
        <UnreadNavCount others={others} unread={server} place={place} part={part} />
        {part === "mark" ? <Settled /> : null}
      </>
    );
  }
  const count = badgeTotal(all, keys);
  return part === "words" ? (
    <NavBadgeWords count={count} />
  ) : (
    <>
      <NavBadgeMark count={count} place={place} />
      <Settled />
    </>
  );
}

/**
 * Marks a spot whose count has arrived, zero included (a zero draws no badge, so nothing else
 * says the stream landed). Hidden, no text: what a test waits for before it compares counts.
 */
function Settled() {
  return <span data-slot="nav-count-settled" hidden />;
}
