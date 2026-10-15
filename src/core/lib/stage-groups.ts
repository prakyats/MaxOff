/**
 * Stage groups and deliverables (phase 6b Release 1, ROADMAP 6b.13 / 6b.16 / 6b.18; owner
 * 2026-10-12/13, pre-authorised). A deliverable (an item, shown as "Deliverable") carries its
 * stages in **groups**, each from a stage preset or typed, shown under the group's heading. The
 * shapes here are the ones the database stores and the functions take (DATA-MODEL §5 "Stage
 * groups and deliverables (6b, Release 1)"); every rule is the database's too.
 *
 * Works on the team's existing data: a stage list from before groups is **one untitled group**
 * (`label` null, no heading) until someone adds a second group or names it. Nothing here depends
 * on any group, stage or deliverable name (CLAUDE.md engineering rule 1): no defaults, no seeds.
 */

/** A group of stages: `label` null is the untitled group (at most one; it always comes first). */
export type StageGroup = { label: string | null; stages: string[] };

/**
 * A deliverable to create (a project template's, or the New project dialog's): its title and its
 * stage groups; `stageGroups` null means "the project's default stage groups".
 */
export type Deliverable = { title: string; stageGroups: StageGroup[] | null };

/** The limits the database checks (`app.stage_groups_check`, `app.deliverables_check`). */
export const STAGES_MAX = 100;
export const DELIVERABLES_MAX = 100;
export const STAGE_NAME_MAX = 120;
export const GROUP_LABEL_MAX = 120;
export const DELIVERABLE_TITLE_MAX = 200;
/** "× N": a typed name times at most this many deliverables in one go. */
export const QUANTITY_MAX = 100;

const key = (name: string) => name.trim().toLowerCase();

/** A plain stage list as groups: one untitled group, or none at all when the list is empty. */
export function groupsFromNames(stages: readonly string[]): StageGroup[] {
  const names = stages.map((name) => name.trim()).filter((name) => name !== "");
  return names.length === 0 ? [] : [{ label: null, stages: names }];
}

/** Every stage of every group, in order (what the old `stages text[]` columns keep holding). */
export function flattenGroups(groups: readonly StageGroup[]): string[] {
  return groups.flatMap((group) => group.stages);
}

function isGroupJson(value: unknown): value is { label?: unknown; stages?: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A `stage_groups` jsonb column as groups. Null (a row from before groups) reads the old
 * `stages` column as one untitled group. Anything malformed is dropped rather than thrown: the
 * database checked the column on every write, so this only guards the type.
 */
export function groupsFromJson(json: unknown, fallbackStages: readonly string[]): StageGroup[] {
  if (json === null || json === undefined) return groupsFromNames(fallbackStages);
  if (!Array.isArray(json)) return groupsFromNames(fallbackStages);
  const groups: StageGroup[] = [];
  for (const entry of json) {
    if (!isGroupJson(entry) || !Array.isArray(entry.stages)) continue;
    const label = typeof entry.label === "string" ? entry.label : null;
    const stages = entry.stages.filter((stage): stage is string => typeof stage === "string");
    groups.push({ label, stages });
  }
  return groups;
}

/** Groups as the jsonb the functions take (`stage_groups`, a deliverable's `stage_groups`). */
export function groupsToJson(
  groups: readonly StageGroup[],
): { label: string | null; stages: string[] }[] {
  return groups.map((group) => ({ label: group.label, stages: [...group.stages] }));
}

/**
 * A template's `deliverables` jsonb column as deliverables. Null (a template from before
 * deliverables) reads the old `items` column, each item with the template's shared stages
 * (`templateGroups`): an old template opens in the new builder with its stages on each item.
 */
export function deliverablesFromJson(
  json: unknown,
  items: readonly string[],
  templateGroups: readonly StageGroup[],
): Deliverable[] {
  if (json === null || json === undefined || !Array.isArray(json)) {
    return items.map((title) => ({
      title,
      stageGroups: templateGroups.map((group) => ({
        label: group.label,
        stages: [...group.stages],
      })),
    }));
  }
  const out: Deliverable[] = [];
  for (const entry of json) {
    if (!isGroupJson(entry) || typeof (entry as { title?: unknown }).title !== "string") continue;
    const groups = (entry as { stage_groups?: unknown }).stage_groups;
    out.push({
      title: (entry as { title: string }).title,
      stageGroups: groups === null || groups === undefined ? null : groupsFromJson(groups, []),
    });
  }
  return out;
}

/** Deliverables as the jsonb `project_create_grouped` and the template column take. */
export function deliverablesToJson(
  deliverables: readonly Deliverable[],
): { title: string; stage_groups: { label: string | null; stages: string[] }[] | null }[] {
  return deliverables.map((deliverable) => ({
    title: deliverable.title,
    stage_groups: deliverable.stageGroups === null ? null : groupsToJson(deliverable.stageGroups),
  }));
}

/** A stage row as the tables keep it: its place in its group, and its group's label and place. */
export type GroupedRow = {
  position: string;
  groupLabel: string | null;
  groupPosition: string | null;
};

/** The rows of one group, in order; `label` null is the untitled group. */
export type RowGroup<T extends GroupedRow> = {
  label: string | null;
  /** The group's own order key (null for the untitled group, which always comes first). */
  groupPosition: string | null;
  rows: T[];
};

/**
 * Stage rows (a project's defaults, an item's own stages) grouped and ordered as the screens show
 * them: the untitled group first, then the named groups by `groupPosition`, each group's rows by
 * `position` (the keys compare as plain strings, as `collate "C"` does). Rows from before
 * groups have no label, so an existing list is one untitled group.
 */
export function groupRows<T extends GroupedRow>(rows: readonly T[]): RowGroup<T>[] {
  const byLabel = new Map<string, RowGroup<T>>();
  for (const row of rows) {
    const id = row.groupLabel === null ? "" : `\u0000${row.groupLabel}`;
    let group = byLabel.get(id);
    if (!group) {
      group = { label: row.groupLabel, groupPosition: row.groupPosition, rows: [] };
      byLabel.set(id, group);
    }
    group.rows.push(row);
  }
  const groups = [...byLabel.values()];
  for (const group of groups) group.rows.sort((a, b) => compareKeys(a.position, b.position));
  groups.sort((a, b) => {
    if (a.label === null) return b.label === null ? 0 : -1;
    if (b.label === null) return 1;
    return compareKeys(a.groupPosition ?? "", b.groupPosition ?? "");
  });
  return groups;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "Reel" × 4 → "Reel 1" … "Reel 4"; × 1 keeps the name as typed. */
export function expandQuantity(name: string, quantity: number): string[] {
  const base = name.trim();
  const count = Math.max(1, Math.min(QUANTITY_MAX, Math.trunc(quantity)));
  if (count === 1) return [base];
  return Array.from({ length: count }, (_, index) => `${base} ${index + 1}`);
}

/** What the preview counts: "6 deliverables · 72 stages". */
export function countDeliverables(
  deliverables: readonly Deliverable[],
  defaults: readonly StageGroup[],
): { deliverables: number; stages: number } {
  let stages = 0;
  for (const deliverable of deliverables) {
    stages += flattenGroups(deliverable.stageGroups ?? defaults).length;
  }
  return { deliverables: deliverables.length, stages };
}

/** "Group · Stage" when the stage sits in a named group, else the stage alone. */
export function groupStageLabel(groupLabel: string | null, stage: string): string {
  return groupLabel === null ? stage : `${groupLabel} · ${stage}`;
}

/**
 * The first thing wrong with a list of groups, in the database's words (`app.stage_groups_check`
 * raises the same VALIDATION), or null when it is fine: at most one untitled group; labels 1..120
 * characters, each once ignoring case; every group at least one stage; stage names 1..120
 * characters, each once in its group ignoring case; at most 100 stages in all.
 */
export function stageGroupsIssue(groups: readonly StageGroup[]): string | null {
  const labels = new Set<string>();
  let untitled = 0;
  let total = 0;
  for (const group of groups) {
    if (group.label === null) {
      untitled += 1;
      if (untitled > 1) return "Only one group can be without a name.";
    } else {
      const label = group.label.trim();
      if (label === "" || label.length > GROUP_LABEL_MAX)
        return `Give the group a name of up to ${GROUP_LABEL_MAX} characters.`;
      if (labels.has(key(label)))
        return `The group ${label} is listed twice: each group needs its own name.`;
      labels.add(key(label));
    }
    if (group.stages.length === 0) return "A group needs at least one stage.";
    const names = new Set<string>();
    for (const stage of group.stages) {
      const name = stage.trim();
      if (name === "" || name.length > STAGE_NAME_MAX)
        return `Each stage needs a name of up to ${STAGE_NAME_MAX} characters.`;
      if (names.has(key(name)))
        return `The stage ${name} is listed twice in its group: each stage needs its own name.`;
      names.add(key(name));
    }
    total += group.stages.length;
  }
  if (total > STAGES_MAX) return `A deliverable has at most ${STAGES_MAX} stages.`;
  return null;
}

/** The first thing wrong with a list of deliverables (`app.deliverables_check`), or null. */
export function deliverablesIssue(deliverables: readonly Deliverable[]): string | null {
  if (deliverables.length > DELIVERABLES_MAX) return `At most ${DELIVERABLES_MAX} deliverables.`;
  for (const deliverable of deliverables) {
    const title = deliverable.title.trim();
    if (title === "" || title.length > DELIVERABLE_TITLE_MAX)
      return `Give each deliverable a title of up to ${DELIVERABLE_TITLE_MAX} characters.`;
    if (deliverable.stageGroups !== null) {
      const issue = stageGroupsIssue(deliverable.stageGroups);
      if (issue !== null) return `${title}: ${issue}`;
    }
  }
  return null;
}
