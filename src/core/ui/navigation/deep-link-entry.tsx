"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Lays the history down for a deep link (§14.2 h): the current entry (`/open?to=…`) becomes the
 * parent list, then the detail is pushed on top, so the first back goes to the list and the
 * entry page itself is never in the stack. Runs once; the parent's screen is never painted (the
 * push follows in the same tick), so the person sees the detail arrive, with the list beneath.
 */
export function DeepLinkEntry({ to, parent }: { to: string; parent: string }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    router.replace(parent);
    router.push(to);
  }, [router, to, parent]);
  return null;
}
