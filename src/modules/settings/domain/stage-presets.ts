/**
 * Stage presets (7.4; PRODUCT §4.16, kickoff 7 decision 22, PERMISSIONS ⁴): a named list of at most
 * 12 stages, shared company-wide. The Owner and Admins add them (`lists.manage`); an Admin edits and
 * archives the ones they created, the Owner any (the seeded one has no author, so only the Owner).
 * A preset is copied into a project when chosen, so a change never touches a project. Nothing in
 * the code depends on a preset's or a stage's name (customisation is data, owner note 3).
 */

export const PRESET_NAME_MAX = 80;
export const PRESET_STAGE_MAX = 120;
export const PRESET_STAGES_MAX = 12;

export type StagePreset = {
  id: string;
  name: string;
  stages: string[];
  archived: boolean;
  /** Null for the seeded preset (it belongs to nobody). */
  createdBy: string | null;
};

export type PresetActions = { edit: boolean; archive: boolean; restore: boolean };

export function presetActions(
  preset: Pick<StagePreset, "createdBy" | "archived">,
  viewer: { id: string; role: string },
): PresetActions {
  const mine =
    viewer.role === "owner" || (preset.createdBy !== null && preset.createdBy === viewer.id);
  return {
    edit: mine && !preset.archived,
    archive: mine && !preset.archived,
    restore: mine && preset.archived,
  };
}

/** "Script → Shoot → Edit → Posted". */
export function stagesLine(stages: readonly string[]): string {
  return stages.join(" → ");
}

/** The stage list a form sends: trimmed, no blanks. */
export function cleanStages(stages: readonly string[]): string[] {
  return stages.map((stage) => stage.trim()).filter((stage) => stage.length > 0);
}
