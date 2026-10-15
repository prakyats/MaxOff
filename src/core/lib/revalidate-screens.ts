import { revalidatePath } from "next/cache";

/**
 * After a change, every signed-in screen is re-read (ARCHITECTURE §10a "Freshness", 6b.17a): the
 * `(app)` layout and everything under it. The rule for every action that changes business data:
 * call this once the write has succeeded, never a hand-picked list of paths. A list drifts: the
 * same row shows on Today, Approvals and its badge, the calendar, a person's month and the
 * record's own page, and the one screen left out of the list is the one that goes stale. The
 * server keeps no cache of its own today (no `unstable_cache`, no `'use cache'`, no incremental
 * cache), so this costs nothing beyond what any revalidation costs: Next re-renders the screen
 * the action ran on and empties the browser's router cache, whichever path is named.
 *
 * Reads are the exception (owner decision 2026-10-01): marking notifications or Chat read never
 * revalidates, so a read never re-renders or reloads the page it is made on.
 */
export function revalidateScreens(): void {
  revalidatePath("/", "layout");
}
