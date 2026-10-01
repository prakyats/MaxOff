"use client";

import { createContext, type ReactNode, use } from "react";

import { NavBadgeMark, NavBadgeWords } from "./nav-badge";

/**
 * The unread count on the title bar's bell (task 5.1). The bell sits in `PageHeader`, which is
 * also drawn inside client components (a list's loading state), so it cannot read the database
 * itself: the shell hands it the layout's own count, a promise the layout starts and never awaits
 * (the nav counts, ARCHITECTURE §19), through this context. The bell's count streams in its own
 * `<Suspense>`; a refresh is a transition, so a count already shown stays until the new one lands.
 */
const BellCountContext = createContext<Promise<number> | null>(null);

export function BellCountProvider({
  count,
  children,
}: {
  count: Promise<number>;
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

function BellCountValue({ promise }: { promise: Promise<number> }) {
  const count = use(promise);
  return (
    <>
      <NavBadgeMark count={count} place="bar" />
      <NavBadgeWords count={count} />
    </>
  );
}
