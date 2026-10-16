/**
 * How the app's enhanced navigation controls move through history (ARCHITECTURE §14.2), as pure
 * functions. The hydrated app uses them (`BackLink`, `ViewLink`, `tab-history`), and so does the
 * inline script that answers the same taps before hydration (`pre-hydration.ts`). Both are
 * tested against the one table in `move-cases.ts`, so the two cannot drift (task 2.8).
 */

/**
 * The on-screen back control (§14.2 k; reworked 2026-10-15, 6b.12 and the owner's "‹ Settings did
 * nothing" report): **one tap always moves**, and only ever to the page its label names.
 *
 * `paths` are the pathnames of this origin's history entries up to and including the current one
 * (the Navigation API's `entries()` to `currentEntry.index`), or null without the API. The
 * entries just beneath that share the current pathname are **this screen's own**: an overlay's
 * spent entry (a sheet, a dialog or a select closed by its button leaves one, `overlay-history`)
 * or a view that wrote its address there. Going back one entry landed on one of them, so the tap
 * changed nothing (found on Settings → Stage presets after Add preset's Cancel). They are stepped
 * over: the page beneath them is the real previous page.
 *
 * Returns how many entries to go back to reach that page when it is the labelled `parent`, an
 * ancestor of it in the same drill-down (`/clients/1` under `/clients/1/projects`), or one of
 * `from`: the other screens this one is drilled into from (a task from the calendar), each an
 * exact pathname or a prefix written `/reports/end-of-day/*`. Otherwise 0: the parent, by
 * replace (opened directly, from a notification, from a screen it was not drilled from, or no
 * Navigation API), which never leaves the app and never adds a step.
 *
 * Self-contained on purpose (no imports, no outer names): the head script carries its source
 * (`pre-hydration.ts`), so the hydrated app and the script share this one function.
 */
export function backSteps(
  paths: readonly (string | null)[] | null,
  parent: string,
  from: readonly string[],
): number {
  if (!paths || paths.length < 2) return 0;
  const here = paths[paths.length - 1];
  let below = paths.length - 2;
  while (below >= 0 && paths[below] === here) below -= 1;
  const target = below >= 0 ? paths[below] : null;
  if (!target) return 0;
  let fits = target === parent || parent.indexOf(target + "/") === 0;
  for (let k = 0; !fits && k < from.length; k += 1) {
    const origin = from[k] ?? "";
    fits =
      origin.slice(-2) === "/*" ? target.indexOf(origin.slice(0, -1)) === 0 : target === origin;
  }
  return fits ? paths.length - 1 - below : 0;
}

/** Whether `path` is the screen an origin pattern of `backSteps` names. */
export function originMatches(origin: string, path: string): boolean {
  return origin.endsWith("/*") ? path.startsWith(origin.slice(0, -1)) : path === origin;
}

/** A view control (a tab of one screen, a pager, a filter) never adds history (§14.1). */
export function viewMove(): "replace" {
  return "replace";
}

export interface TabMoveInput {
  /** The tab tapped. */
  href: string;
  /** Where we are. */
  pathname: string;
  /** The role's home tab. */
  home: string;
  /** Every top-level destination (bar, More sheet, profile). */
  topLevel: readonly string[];
  /** Running installed; a browser tab keeps the web's own history. */
  standalone: boolean;
  /** The entry beneath this one is home, put there by a tab move of ours. */
  pushedFromHome: boolean;
}

/**
 * Top-level tabs never stack history when installed: the stack is at most `[home, tab]`
 * (`tab-history.ts` has the full reasoning). `null` means "not ours": an ordinary link push.
 *
 * | From | To | Move |
 * |---|---|---|
 * | home | tab | push |
 * | tab | another tab | replace |
 * | tab | home | back if home is beneath, else replace |
 */
export function tabMove({
  href,
  pathname,
  home,
  topLevel,
  standalone,
  pushedFromHome,
}: TabMoveInput): "push" | "replace" | "back" | null {
  if (!standalone || !topLevel.includes(href) || !topLevel.includes(pathname)) return null;
  if (href === pathname) return null;
  if (href === home) return pushedFromHome ? "back" : "replace";
  return pathname === home ? "push" : "replace";
}
