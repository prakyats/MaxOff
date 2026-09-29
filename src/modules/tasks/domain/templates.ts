import type { TaskDraft } from "./form";
import type { MemberRole, Priority } from "./types";

/**
 * Task templates (4.6; PRODUCT §4.6, WORKFLOWS §3.5, Kickoff 4 decision 19): a type, default
 * stages, a priority, a description and the task fields' defaults; never a client, people or a
 * deadline. Shared company-wide; an Admin edits and archives the ones they created, the Owner any.
 */

export type TaskTemplate = {
  id: string;
  name: string;
  taskTypeId: string;
  description: string | null;
  defaultPriority: Priority;
  stages: string[];
  fieldDefaults: Record<string, unknown>;
  archived: boolean;
  createdBy: string;
};

export type TemplateActions = { edit: boolean; archive: boolean; restore: boolean };

export function templateActions(
  template: Pick<TaskTemplate, "createdBy" | "archived">,
  viewer: { id: string; role: MemberRole },
): TemplateActions {
  const mine = viewer.role === "owner" || template.createdBy === viewer.id;
  return {
    edit: mine && !template.archived,
    archive: mine && !template.archived,
    restore: mine && template.archived,
  };
}

/**
 * "Start from" a template in the create dialog: the type, the priority and the stages are the
 * template's; the description only when none was typed; each field default only where the task
 * has no value yet. The title, the client label, the people and the deadline stay as they are
 * (PRODUCT §4.6: a template never fixes them).
 */
export function applyTemplate(draft: TaskDraft, template: TaskTemplate): TaskDraft {
  const customFields = { ...draft.customFields };
  for (const [key, value] of Object.entries(template.fieldDefaults)) {
    const current = customFields[key];
    if (current === undefined || current === null || current === "") customFields[key] = value;
  }
  return {
    ...draft,
    taskTypeId: template.taskTypeId,
    priority: template.defaultPriority,
    stages: [...template.stages],
    description: draft.description.trim() ? draft.description : (template.description ?? ""),
    customFields,
  };
}

/** Active ones by name, for the dialog's "Start from" and the Settings list. */
export function activeTemplates(templates: readonly TaskTemplate[]): TaskTemplate[] {
  return templates
    .filter((template) => !template.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}
