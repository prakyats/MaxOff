/**
 * How the app's enhanced navigation controls move through history (ARCHITECTURE §14.2), as pure
 * functions. The hydrated app uses them (`BackLink`, `ViewLink`, `tab-history`), and so does the
 * inline script that answers the same taps before hydration (`pre-hydration.ts`). Both are
 * tested against the one table in `move-cases.ts`, so the two cannot drift (task 2.8).
 */

/**
 * The on-screen back control (§14.2 k): with an entry of this app beneath the current one it
 * goes back to it (no new entry); a page opened directly (a deep link, a new window, the first
 * page after a restart) has nothing of ours beneath, so it goes to its parent and **replaces**
 * itself, never leaving the app and never adding a step.
 *
 * `index` is the Navigation API's `currentEntry.index`, which counts this origin's entries only.
 * Without the API (an older browser) the answer is the parent: the safe one, since it can never
 * leave the app.
 */
export function backMove(index: number | undefined): "back" | "parent" {
  return index !== undefined && index > 0 ? "back" : "parent";
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
