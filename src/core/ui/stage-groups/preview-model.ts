import {
  countDeliverables,
  type Deliverable,
  flattenGroups,
  type StageGroup,
} from "@/core/lib/stage-groups";

/**
 * What the live preview draws (ROADMAP 6b.16 (a); owner feedback 2026-10-15, issue #89), as pure
 * functions: the summary figures, and the entries, where **identical** deliverables next to each
 * other (the same groups and stages, both own or both default) show as one entry: a numbered run
 * ("Item 1" … "Item 4") as "Item 1–4" ×4, any other names as "A, B" ×2 (v1.7.1). Anything else
 * keeps its own entry, in the order built. Each deliverable keeps a stable key across edits
 * (`previewKeys`), so a change highlights the entry it happened to, never a card by position.
 */

export type PreviewStats = { deliverables: number; groups: number; stages: number };

/**
 * The summary: deliverables, the distinct named groups among them (ignoring case: "Phase A" on
 * six deliverables is one group), and every stage that will be created.
 */
export function previewStats(
  deliverables: readonly Deliverable[],
  defaults: readonly StageGroup[],
): PreviewStats {
  const labels = new Set<string>();
  for (const deliverable of deliverables) {
    for (const group of deliverable.stageGroups ?? defaults) {
      if (group.label !== null) labels.add(group.label.trim().toLowerCase());
    }
  }
  const counts = countDeliverables(deliverables, defaults);
  return { deliverables: counts.deliverables, groups: labels.size, stages: counts.stages };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The summary tiles' words, in order: "6 deliverables", "3 groups", "36 stages". */
export function statsTiles(stats: PreviewStats): { figure: number; word: string; id: string }[] {
  return [
    {
      id: "deliverables",
      figure: stats.deliverables,
      word: stats.deliverables === 1 ? "deliverable" : "deliverables",
    },
    { id: "groups", figure: stats.groups, word: stats.groups === 1 ? "group" : "groups" },
    { id: "stages", figure: stats.stages, word: stats.stages === 1 ? "stage" : "stages" },
  ];
}

/** The summary as one line ("6 deliverables · 3 groups · 36 stages"), for assistive tech. */
export function statsLine(stats: PreviewStats): string {
  return statsTiles(stats)
    .map((tile) => `${tile.figure} ${tile.word}`)
    .join(" · ");
}

export type PreviewEntry = {
  /** The first deliverable's index in the list. */
  start: number;
  /** The first deliverable's stable key (`previewKeys`), or its index when none is given. */
  key: string;
  /** "Item 1–4" for a numbered run, "A, B" for other identical ones, else the title. */
  label: string;
  /** Every title in the entry, in order. */
  titles: string[];
  /** The groups each one creates (its own, or the defaults). */
  groups: StageGroup[];
  /** True when the deliverables have their own stages; false when they use the defaults. */
  own: boolean;
};

/** "Item 4" as its base "Item" and number 4; null when the name does not end in a number. */
export function numbered(title: string): { base: string; number: number } | null {
  const match = /^(.*?)(\d+)$/.exec(title.trim());
  if (!match) return null;
  const base = (match[1] ?? "").trimEnd();
  if (base === "") return null;
  return { base, number: Number(match[2]) };
}

function signature(own: boolean, groups: readonly StageGroup[]): string {
  return JSON.stringify([own, groups.map((group) => [group.label, group.stages])]);
}

/** How many names an entry of identical, unnumbered deliverables spells out before "+N". */
const NAMES_SHOWN = 3;

/** An entry's label: the title, "Item 1–4" for a numbered run, else "A, B, C +2". */
export function entryLabel(titles: readonly string[]): string {
  if (titles.length === 1) return titles[0] ?? "";
  const names = titles.map(numbered);
  const first = names[0];
  const run =
    first !== null &&
    first !== undefined &&
    names.every(
      (name, index) =>
        name !== null &&
        name.base.toLowerCase() === first.base.toLowerCase() &&
        name.number === first.number + index,
    );
  if (run) return `${first.base} ${first.number}–${first.number + titles.length - 1}`;
  const shown = titles.slice(0, NAMES_SHOWN).join(", ");
  return titles.length > NAMES_SHOWN ? `${shown} +${titles.length - NAMES_SHOWN}` : shown;
}

/**
 * The preview's entries: each deliverable, with identical neighbours collapsed into one (a
 * numbered run, or any names). `keys` (from `previewKeys`) are the deliverables' stable keys.
 */
export function previewEntries(
  deliverables: readonly Deliverable[],
  defaults: readonly StageGroup[],
  keys?: readonly string[],
): PreviewEntry[] {
  const entries: PreviewEntry[] = [];
  let last: { entry: PreviewEntry; sig: string } | null = null;
  deliverables.forEach((deliverable, index) => {
    const own = deliverable.stageGroups !== null;
    const groups = deliverable.stageGroups ?? [...defaults];
    const sig = signature(own, groups);
    if (last && last.sig === sig) {
      last.entry.titles.push(deliverable.title);
      return;
    }
    const entry: PreviewEntry = {
      start: index,
      key: keys?.[index] ?? String(index),
      label: deliverable.title,
      titles: [deliverable.title],
      groups,
      own,
    };
    entries.push(entry);
    last = { entry, sig };
  });
  for (const entry of entries) entry.label = entryLabel(entry.titles);
  return entries;
}

/**
 * Stable keys for the deliverables across an edit (v1.7.1, issue #89 (iii)): each new title takes
 * the key of an unclaimed one of the same title from before (in order, so repeated names keep
 * theirs); what is left pairs up in order (a renamed deliverable keeps its key); anything more is
 * new and gets `mint(n)` (n counting the new ones from 0). So inserting, removing or reordering never hands a card another's key.
 */
export function previewKeys(
  before: readonly { title: string; key: string }[],
  titles: readonly string[],
  mint: (n: number) => string,
): string[] {
  const claimed = new Set<number>();
  const keys: (string | null)[] = titles.map((title) => {
    const at = before.findIndex((row, index) => !claimed.has(index) && row.title === title);
    if (at < 0) return null;
    claimed.add(at);
    return before[at]?.key ?? null;
  });
  const left = before.filter((_, index) => !claimed.has(index));
  let next = 0;
  let minted = 0;
  return keys.map((key) => {
    if (key !== null) return key;
    const reused = left[next];
    next += 1;
    if (reused) return reused.key;
    minted += 1;
    return mint(minted - 1);
  });
}

/** An entry's counts: "4 stages", "2 groups · 7 stages", "… each" for a run. */
export function entryCounts(entry: PreviewEntry): string {
  const stages = flattenGroups(entry.groups).length;
  const named = entry.groups.filter((group) => group.label !== null).length;
  const parts = [
    ...(named > 0 ? [plural(entry.groups.length, "group", "groups")] : []),
    plural(stages, "stage", "stages"),
  ];
  return `${parts.join(" · ")}${entry.titles.length > 1 ? " each" : ""}`;
}
