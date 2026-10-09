/**
 * Project templates (7.4; PRODUCT §4.5, §4.16; kickoff 7 decision 23, PERMISSIONS ⁴): a reusable
 * setup with a recurrence, stages (from a preset or typed), an item list and the project fields'
 * defaults. Shared company-wide (`templates.manage`: the Owner and Admins); an Admin edits and
 * archives the ones they created, the Owner any. **No billing category in phase 7** (amendment C:
 * money is the Owner's, phase 9). A project made from one copies it; nothing stays linked.
 */

export const TEMPLATE_NAME_MAX = 120;
export const TEMPLATE_DESCRIPTION_MAX = 2000;
export const TEMPLATE_STAGES_MAX = 12;
export const TEMPLATE_ITEMS_MAX = 100;

export type TemplateRecurrence = "one_time" | "weekly" | "monthly";

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string | null;
  recurrence: TemplateRecurrence;
  stages: string[];
  items: string[];
  fieldDefaults: Record<string, unknown>;
  archived: boolean;
  createdBy: string;
};

export function projectTemplateActions(
  template: Pick<ProjectTemplate, "createdBy" | "archived">,
  viewer: { id: string; role: string },
): { edit: boolean; archive: boolean; restore: boolean } {
  const mine = viewer.role === "owner" || template.createdBy === viewer.id;
  return {
    edit: mine && !template.archived,
    archive: mine && !template.archived,
    restore: mine && template.archived,
  };
}

/** Lines of a textarea as a clean list (one stage or item per line, blanks dropped). */
export function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
