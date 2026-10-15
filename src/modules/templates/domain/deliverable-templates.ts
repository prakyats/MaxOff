/**
 * Deliverable templates (6b Release 2; ROADMAP 6b.13 (2), 6b.16; DATA-MODEL §5b "Deliverable
 * templates and Save as template"; PERMISSIONS ⁴): a reusable deliverable, its name and its stage
 * groups. Shared company-wide (`templates.manage`: the Owner and Admins); an Admin edits and
 * archives the ones they made, the Owner any. Archived with a reason, never deleted. A deliverable
 * made from one copies its groups; nothing stays linked. Nothing is pre-defined.
 */

import type { StageGroup } from "@/core/lib/stage-groups";

export const DELIVERABLE_TEMPLATE_NAME_MAX = 120;
export const ARCHIVE_REASON_MAX = 1000;

export type DeliverableTemplate = {
  id: string;
  name: string;
  stageGroups: StageGroup[];
  archived: boolean;
  archivedReason: string | null;
  createdBy: string;
};

/** What the viewer may do with a template: the author's own, or any for the Owner. */
export function templateRowActions(
  template: { createdBy: string; archived: boolean },
  viewer: { id: string; role: string },
): { edit: boolean; archive: boolean; restore: boolean } {
  const mine = viewer.role === "owner" || template.createdBy === viewer.id;
  return {
    edit: mine && !template.archived,
    archive: mine && !template.archived,
    restore: mine && template.archived,
  };
}
