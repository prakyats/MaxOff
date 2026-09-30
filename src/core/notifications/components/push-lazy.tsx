"use client";

import dynamic from "next/dynamic";

/**
 * The push banner and the re-subscribe check, split out of the shared first load (phase 4
 * review A-L6: `/today` and `/my-day` sit at their first-load budget, and every signed-in screen
 * mounts these from the layout). The banner still renders on the server, so its row is in the
 * first paint and nothing moves; its code (and the subscribe path) arrives in its own chunk, only
 * for a member with no working device. The sync renders nothing, so it loads after hydration.
 */
export const PushBanner = dynamic(() =>
  import("./push-banner").then((module) => module.PushBanner),
);

export const PushSync = dynamic(() => import("./push-sync").then((module) => module.PushSync), {
  ssr: false,
});
