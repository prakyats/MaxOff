import type { TabMoveInput } from "./moves";

/**
 * The one table of navigation moves (task 2.8, owner condition): `moves.test.ts` runs it against
 * the app's functions and `pre-hydration.test.ts` against the inline script, so a rule changed
 * on one side and not the other fails a test.
 */

/**
 * The back control (`backSteps`): `paths` are this origin's entries' pathnames up to the current
 * one (null: no Navigation API); `expected` is how many entries back the tap goes, 0 for the
 * parent by replace. One tap always moves (2026-10-15).
 */
export const BACK_CASES: readonly {
  name: string;
  paths: readonly (string | null)[] | null;
  parent: string;
  from?: readonly string[];
  expected: number;
}[] = [
  {
    name: "the parent beneath: back one",
    paths: ["/today", "/settings", "/settings/stage-presets"],
    parent: "/settings",
    expected: 1,
  },
  {
    name: "a sheet's spent entry on top: back over it to the parent (the no-op tap, 2026-10-15)",
    paths: ["/settings", "/settings/stage-presets", "/settings/stage-presets"],
    parent: "/settings",
    expected: 2,
  },
  {
    name: "a select's spent entry over a dialog's: back over both",
    paths: ["/tasks", "/tasks/1", "/tasks/1", "/tasks/1"],
    parent: "/tasks",
    expected: 3,
  },
  {
    name: "an ancestor of the parent beneath: back to it",
    paths: ["/clients/1", "/clients/1/projects/2"],
    parent: "/clients/1/projects",
    expected: 1,
  },
  {
    name: "a screen it is drilled into from: back to it (a task from the calendar)",
    paths: ["/today", "/calendar", "/tasks/9", "/tasks/9"],
    parent: "/tasks",
    from: ["/calendar", "/today"],
    expected: 2,
  },
  {
    name: "an origin given as a prefix",
    paths: ["/reports/end-of-day/2026-10-01", "/tasks/9"],
    parent: "/tasks",
    from: ["/reports/end-of-day/*"],
    expected: 1,
  },
  {
    name: "another screen beneath (arrived from Today): the parent, replacing",
    paths: ["/today", "/settings/stage-presets"],
    parent: "/settings",
    expected: 0,
  },
  {
    name: "a sibling beneath: the parent, replacing",
    paths: ["/settings", "/settings/job-titles", "/settings/stage-presets"],
    parent: "/settings",
    expected: 0,
  },
  {
    name: "the root is never an ancestor",
    paths: ["/", "/settings/stage-presets"],
    parent: "/settings",
    expected: 0,
  },
  {
    name: "opened directly (first entry): the parent, replacing",
    paths: ["/settings/stage-presets"],
    parent: "/settings",
    expected: 0,
  },
  {
    name: "only this screen's own entries beneath: the parent, replacing",
    paths: ["/settings/stage-presets", "/settings/stage-presets"],
    parent: "/settings",
    expected: 0,
  },
  {
    name: "an entry whose address is unknown beneath: the parent",
    paths: [null, "/settings/stage-presets"],
    parent: "/settings",
    expected: 0,
  },
  {
    name: "no Navigation API: the parent, the safe answer",
    paths: null,
    parent: "/settings",
    expected: 0,
  },
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
