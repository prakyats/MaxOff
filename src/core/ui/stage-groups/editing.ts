import {
  type Deliverable,
  type StageGroup,
  expandQuantity,
  flattenGroups,
} from "@/core/lib/stage-groups";

/**
 * The editors' changes as pure functions (ROADMAP 6b.13, 6b.16 (b)): each takes the value and
 * returns a new one, so `StageGroupsEditor` and `DeliverablesEditor` stay thin and every rule
 * has a unit test. Nothing here knows a name: presets and groups are whatever the Admin made.
 */

export type StagePresetOption = { id: string; name: string; stages: readonly string[] };

/** A textarea as clean lines (one stage per line, blanks dropped). */
export function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

const key = (name: string) => name.trim().toLowerCase();

/** `name`, or `name 2`, `name 3`… when a group already has it (ignoring case). */
export function uniqueLabel(groups: readonly StageGroup[], name: string): string {
  const base = name.trim();
  const taken = new Set(
    groups.flatMap((group) => (group.label === null ? [] : [key(group.label)])),
  );
  if (!taken.has(key(base))) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(key(candidate))) return candidate;
  }
}

/** Groups in their kept order: the untitled one (at most one) first, then the named ones. */
export function untitledFirst(groups: readonly StageGroup[]): StageGroup[] {
  return [
    ...groups.filter((group) => group.label === null),
    ...groups.filter((group) => group.label !== null),
  ];
}

/** "Add from a preset": a new group named after the preset (renamable), with its stages. */
export function addPresetGroup(
  groups: readonly StageGroup[],
  preset: StagePresetOption,
): StageGroup[] {
  return [...groups, { label: uniqueLabel(groups, preset.name), stages: [...preset.stages] }];
}

/**
 * "Add a group": a typed name and stages. No name adds the untitled group when there is none
 * (it goes first); the caller refuses a second one.
 */
export function addTypedGroup(
  groups: readonly StageGroup[],
  label: string,
  stages: readonly string[],
): StageGroup[] {
  const name = label.trim();
  const group: StageGroup = { label: name === "" ? null : name, stages: [...stages] };
  return untitledFirst([...groups, group]);
}

export function hasUntitled(groups: readonly StageGroup[]): boolean {
  return groups.some((group) => group.label === null);
}

/** Change one group (by index), keeping the rest. */
export function updateGroup(
  groups: readonly StageGroup[],
  index: number,
  change: (group: StageGroup) => StageGroup,
): StageGroup[] {
  return groups.map((group, at) => (at === index ? change(group) : group));
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, at) => at !== index);
}

/** A deliverable's groups from the presets picked for it, in the order they were picked. */
export function groupsFromPresets(picks: readonly StagePresetOption[]): StageGroup[] {
  return picks.reduce<StageGroup[]>((groups, preset) => addPresetGroup(groups, preset), []);
}

/**
 * The add row: "Name" × N deliverables ("Name 1" … "Name N"; × 1 keeps the name), each with the
 * picked presets as its groups, or the default stages (`stageGroups` null) when none is picked.
 * `base` (a deliverable template's groups, 6b Release 2) comes first, the picked presets after it.
 */
export function newDeliverables(
  name: string,
  quantity: number,
  picks: readonly StagePresetOption[],
  base: readonly StageGroup[] | null = null,
): Deliverable[] {
  const groups =
    base !== null
      ? picks.reduce<StageGroup[]>((list, preset) => addPresetGroup(list, preset), copyGroups(base))
      : picks.length > 0
        ? groupsFromPresets(picks)
        : null;
  return expandQuantity(name, quantity).map((title) => ({
    title,
    stageGroups: groups === null ? null : copyGroups(groups),
  }));
}

export function copyGroups(groups: readonly StageGroup[]): StageGroup[] {
  return groups.map((group) => ({ label: group.label, stages: [...group.stages] }));
}

/** A copy of a deliverable right after it ("… (copy)"), with its own copy of the groups. */
export function duplicateDeliverable(list: readonly Deliverable[], index: number): Deliverable[] {
  const source = list[index];
  if (!source) return [...list];
  const copy: Deliverable = {
    title: `${source.title} (copy)`,
    stageGroups: source.stageGroups === null ? null : copyGroups(source.stageGroups),
  };
  return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
}

/** "2 groups · 12 stages" (or "12 stages" for one untitled group) for a collapsed row. */
export function groupsSummary(groups: readonly StageGroup[]): string {
  const stages = flattenGroups(groups).length;
  const stageWords = stages === 1 ? "1 stage" : `${stages} stages`;
  const named = groups.filter((group) => group.label !== null).length;
  if (named === 0) return stageWords;
  return `${groups.length === 1 ? "1 group" : `${groups.length} groups`} · ${stageWords}`;
}

/** "6 deliverables · 72 stages". */
export function countsLine(counts: { deliverables: number; stages: number }): string {
  const deliverables =
    counts.deliverables === 1 ? "1 deliverable" : `${counts.deliverables} deliverables`;
  const stages = counts.stages === 1 ? "1 stage" : `${counts.stages} stages`;
  return `${deliverables} · ${stages}`;
}
