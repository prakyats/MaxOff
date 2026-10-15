import {
  countDeliverables,
  type Deliverable,
  flattenGroups,
  type StageGroup,
} from "@/core/lib/stage-groups";

/**
 * What the live preview draws (ROADMAP 6b.16 (a); owner feedback 2026-10-15, issue #89), as pure
 * functions: the summary figures, and the entries, where a run of **identical** deliverables with
 * numbered names ("Item 1" … "Item 4", the same groups and stages, both own or both default)
 * shows as one entry "Item 1–4" ×4. Anything else keeps its own entry, in the order built.
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
  /** The first deliverable's index (a stable key while the list keeps its shape). */
  start: number;
  /** "Item 1–4" for a run, else the deliverable's title. */
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

/** The preview's entries: each deliverable, with numbered runs of identical ones collapsed. */
export function previewEntries(
  deliverables: readonly Deliverable[],
  defaults: readonly StageGroup[],
): PreviewEntry[] {
  const entries: PreviewEntry[] = [];
  let run: { entry: PreviewEntry; sig: string; base: string; last: number } | null = null;
  deliverables.forEach((deliverable, index) => {
    const own = deliverable.stageGroups !== null;
    const groups = deliverable.stageGroups ?? [...defaults];
    const sig = signature(own, groups);
    const name = numbered(deliverable.title);
    if (
      run &&
      name &&
      run.sig === sig &&
      run.base.toLowerCase() === name.base.toLowerCase() &&
      name.number === run.last + 1
    ) {
      run.last = name.number;
      run.entry.titles.push(deliverable.title);
      return;
    }
    const entry: PreviewEntry = {
      start: index,
      label: deliverable.title,
      titles: [deliverable.title],
      groups,
      own,
    };
    entries.push(entry);
    run = name ? { entry, sig, base: name.base, last: name.number } : null;
  });
  for (const entry of entries) {
    if (entry.titles.length < 2) continue;
    const first = numbered(entry.titles[0] ?? "");
    const last = numbered(entry.titles[entry.titles.length - 1] ?? "");
    if (first && last) entry.label = `${first.base} ${first.number}–${last.number}`;
  }
  return entries;
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
