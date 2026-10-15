"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

import { drawingShownAgain } from "./drawings";

/**
 * A screen shown again from the router's cache re-reads itself (6b.12 (1), v1.7.1).
 *
 * Next keeps the screens of this session in its client cache: back and forward restore one, and
 * a tap on a tab seen in the last 30 s (`staleTimes.dynamic`, next.config.ts) shows it again,
 * without asking the server. A change made on this device revalidates and empties that cache
 * (a server action that revalidates), but **a change someone else made** is not known here: the
 * calendar came back with a deadline on its old day. Mounted in a screen with a `renderId` its
 * server render draws (one per render, `crypto.randomUUID()`), it tells a fresh drawing (first
 * mounted now: nothing to do) from one shown again (mounted before): that one is re-read in
 * place with `router.refresh()`, which keeps the screen's own state (the day picked, a size, the
 * scroll) and swaps in the new data. No polling, no Realtime: a return is the moment it reads.
 */
export function FreshOnReturn({ renderId }: { renderId: string }): null {
  const router = useRouter();
  useEffect(() => {
    if (drawingShownAgain(renderId)) startTransition(() => router.refresh());
  }, [renderId, router]);
  return null;
}
