import "server-only";

import type { DeliverableTemplateOption } from "@/core/lib/stage-groups";
import { assertPermission } from "@/core/permissions/server";
import { listDirectoryOf } from "@/modules/team";
import { listDeliverableTemplates } from "@/modules/templates";

import * as repo from "../data/projects";
import { type ActivityPage, describeActivityLines } from "../domain/activity";
import { activityPageSchema } from "../domain/schemas";

/** Entries per page of the activity panel (the owner's preview feedback: the latest 20). */
export const ACTIVITY_PAGE = 20;

/**
 * One page of a project's activity, or one item's (the owner's preview feedback, 2026-10-09):
 * `GET /api/client-work/activity`, a **background call** (ARCHITECTURE §4.4: the panel reads as it
 * opens and on "Show older", never through a server action that could hold a navigation). zod →
 * `assertPermission("projects.manage")` (the Owner, the client's Admin; Crew never) → the
 * repository, under RLS (another Admin's project reads as nothing). Newest first, 20 entries
 * before the cursor (keyset), each described as one sentence (one group change's per-stage
 * entries as one line, so a page may hold fewer than 20 lines); `next` is where the following page
 * starts, null at the end. Never an amount.
 */
export async function readProjectActivity(input: unknown): Promise<ActivityPage> {
  const query = activityPageSchema.parse(input);
  const viewer = await assertPermission("projects.manage");
  const entries = await repo.pageProjectActivity({
    projectId: query.projectId,
    kind: query.kind,
    itemId: query.itemId,
    before:
      query.beforeAt !== null && query.beforeId !== null
        ? { at: query.beforeAt, id: query.beforeId }
        : null,
    limit: ACTIVITY_PAGE,
  });
  // The previous page's last entry (the cursor's own): a group change cut by that page's end
  // is not said again here. Keyset order is (at, id) newest first, so the one entry before
  // (at, id + 1) is the cursor's.
  const cursor =
    query.beforeAt !== null && query.beforeId !== null
      ? ((
          await repo.pageProjectActivity({
            projectId: query.projectId,
            kind: query.kind,
            itemId: query.itemId,
            before: { at: query.beforeAt, id: query.beforeId + 1 },
            limit: 1,
          })
        ).find((entry) => entry.id === query.beforeId) ?? null)
      : null;
  const described = cursor ? [cursor, ...entries] : entries;
  const itemEntities = new Set(["project_items", "project_item_stage_list", "project_item_stages"]);
  const itemIds = [
    ...new Set(
      described.filter((entry) => itemEntities.has(entry.entity)).map((entry) => entry.entityId),
    ),
  ];
  const actorIds = [
    ...new Set(described.flatMap((entry) => (entry.actorId ? [entry.actorId] : []))),
  ];
  const needsStages = entries.some((entry) => entry.entity === "project_item_stages");
  const [items, people, stages] = await Promise.all([
    repo.listItemsById(itemIds),
    listDirectoryOf(actorIds),
    needsStages ? repo.listStages(query.projectId) : Promise.resolve([]),
  ]);
  const context = {
    names: Object.fromEntries(people.map((person) => [person.id, person.fullName])),
    items: Object.fromEntries(items.map((item) => [item.id, item.title])),
    stages: Object.fromEntries(stages.map((stage) => [stage.id, stage.name])),
    viewerId: viewer.id,
  };
  const last = entries.at(-1);
  return {
    // A group rename or move is one line, however many stages it touched (6b).
    lines: describeActivityLines(entries, context, cursor),
    next: entries.length === ACTIVITY_PAGE && last ? { at: last.at, id: last.id } : null,
  };
}

/**
 * The active deliverable templates "+ Add deliverable" offers (6b Release 2): `GET
 * /api/client-work/deliverable-templates`, a background call the dialog's effect sends as it
 * opens (ARCHITECTURE §4.4; the project page does not load them up front). `projects.manage`
 * (the Owner, the client's Admin; Crew never), RLS deciding the rows (`templates.manage`).
 */
export async function readDeliverableTemplateOptions(): Promise<DeliverableTemplateOption[]> {
  await assertPermission("projects.manage");
  const templates = await listDeliverableTemplates();
  return templates
    .filter((template) => !template.archived)
    .map((template) => ({
      id: template.id,
      name: template.name,
      stageGroups: template.stageGroups,
    }));
}
