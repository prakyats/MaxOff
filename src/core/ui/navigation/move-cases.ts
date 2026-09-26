import type { TabMoveInput } from "./moves";

/**
 * The one table of navigation moves (task 2.8, owner condition): `moves.test.ts` runs it against
 * the app's functions and `pre-hydration.test.ts` against the inline script, so a rule changed
 * on one side and not the other fails a test.
 */

export const BACK_CASES: readonly {
  name: string;
  /** The Navigation API's `currentEntry.index`; undefined = no Navigation API. */
  index: number | undefined;
  expected: "back" | "parent";
}[] = [
  { name: "an entry of ours beneath: back", index: 3, expected: "back" },
  { name: "one entry beneath: back", index: 1, expected: "back" },
  { name: "opened directly (first entry): parent, replacing", index: 0, expected: "parent" },
  { name: "no Navigation API: parent, the safe answer", index: undefined, expected: "parent" },
];

export const VIEW_CASES: readonly { name: string; expected: "replace" }[] = [
  { name: "a view control replaces the entry", expected: "replace" },
];

export const TAB_HOME = "/today";
export const TAB_TOP_LEVEL = ["/today", "/tasks", "/clients", "/approvals", "/settings", "/me"];

export const TAB_CASES: readonly {
  name: string;
  input: Omit<TabMoveInput, "home" | "topLevel">;
  expected: "push" | "replace" | "back" | null;
}[] = [
  {
    name: "home → tab pushes",
    input: { href: "/tasks", pathname: "/today", standalone: true, pushedFromHome: false },
    expected: "push",
  },
  {
    name: "tab → tab replaces",
    input: { href: "/clients", pathname: "/tasks", standalone: true, pushedFromHome: true },
    expected: "replace",
  },
  {
    name: "tab → a More destination replaces too",
    input: { href: "/me", pathname: "/settings", standalone: true, pushedFromHome: true },
    expected: "replace",
  },
  {
    name: "tab → home goes back when home is beneath",
    input: { href: "/today", pathname: "/tasks", standalone: true, pushedFromHome: true },
    expected: "back",
  },
  {
    name: "tab → home replaces when home is not beneath (opened on the tab)",
    input: { href: "/today", pathname: "/tasks", standalone: true, pushedFromHome: false },
    expected: "replace",
  },
  {
    name: "the current tab again: not ours",
    input: { href: "/tasks", pathname: "/tasks", standalone: true, pushedFromHome: true },
    expected: null,
  },
  {
    name: "from a drill-down: not ours (an ordinary push)",
    input: { href: "/tasks", pathname: "/people/1", standalone: true, pushedFromHome: false },
    expected: null,
  },
  {
    name: "in a browser tab: never ours",
    input: { href: "/tasks", pathname: "/today", standalone: false, pushedFromHome: false },
    expected: null,
  },
];
