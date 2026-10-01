"use client";

import { createContext, type ReactNode, use } from "react";

import type { ServerUnread } from "@/core/notifications/read-receipts";
import { useUnreadShown } from "@/core/notifications/use-unread";

import { NavBadgeMark, type NavBadgePlace, NavBadgeWords } from "./nav-badge";

/**
 * The unread count on the title bar's bell (task 5.1). The bell sits in `PageHeader`, which is
 * also drawn inside client components (a list's loading state), so it cannot read the database
 * itself: the shell hands it the layout's own count, a promise the layout starts and never awaits
 * (the nav counts, ARCHITECTURE §19), through this context. The bell's count streams in its own
 * `<Suspense>`; a refresh is a transition, so a count already shown stays until the new one lands.
 * The member's own reads come off it on the device at once (`useUnreadShown`, owner decision
 * 2026-10-01): a read never re-reads the page.
 */
const BellCountContext = createContext<Promise<ServerUnread> | null>(null);

export function BellCountProvider({
  count,
  children,
}: {
  count: Promise<ServerUnread>;
  children: ReactNode;
}) {
  return <BellCountContext value={count}>{children}</BellCountContext>;
}

/** The count's disc on the bell and its words for a screen reader; nothing outside the shell. */
export function BellCountMark() {
  const promise = use(BellCountContext);
  if (!promise) return null;
  return <BellCountValue promise={promise} />;
}

function BellCountValue({ promise }: { promise: Promise<ServerUnread> }) {
  const count = useUnreadShown(use(promise));
  return (
    <>
      <NavBadgeMark count={count} place="bar" />
      <NavBadgeWords count={count} />
    </>
  );
}

/**
 * A nav count that holds the unread notifications (Staff's Alerts tab, the desktop bell, a More
 * cell with Alerts behind it): the server's other counts plus the bell's, less this device's own
 * reads not yet counted (owner decision 2026-10-01: a read never re-reads the page).
 */
export function UnreadNavCount({
  others,
  unread,
  place,
  part,
}: {
  others: number;
  unread: ServerUnread;
  place: NavBadgePlace;
  part: "mark" | "words";
}) {
  const count = others + useUnreadShown(unread);
  return part === "words" ? (
    <NavBadgeWords count={count} />
  ) : (
    <NavBadgeMark count={count} place={place} />
  );
}
