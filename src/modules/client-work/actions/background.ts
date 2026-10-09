import "server-only";

import { assertPermission } from "@/core/permissions/server";
import { listDirectoryOf } from "@/modules/team";

import * as repo from "../data/projects";
import { type ActivityPage, describeProjectActivity } from "../domain/activity";
import { activityPageSchema } from "../domain/schemas";

/** Entries per page of the activity panel (the owner's preview feedback: the latest 20). */
export const ACTIVITY_PAGE = 20;

/**
 * One page of a project's activity, or one item's (the owner's preview feedback, 2026-10-09):
 * `GET /api/client-work/activity`, a **background call** (ARCHITECTURE §4.4: the panel reads as it
 * opens and on "Show older", never through a server action that could hold a navigation). zod →
 * `assertPermission("projects.manage")` (the Owner, the client's Admin; Crew never) → the
 * repository, under RLS (another Admin's project reads as nothing). Newest first, 20 entries
 * before the cursor (keyset), each described as one sentence; `next` is where the following page
 * starts, null at the end. Never an amount.
 */
export async function readProjectActivity(input: unknown): Promise<ActivityPage> {
  const query = activityPageSchema.parse(input);
  await assertPermission("projects.manage");
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
  const itemEntities = new Set(["project_items", "project_item_stage_list", "project_item_stages"]);
  const itemIds = [
    ...new Set(
      entries.filter((entry) => itemEntities.has(entry.entity)).map((entry) => entry.entityId),
    ),
  ];
  const actorIds = [...new Set(entries.flatMap((entry) => (entry.actorId ? [entry.actorId] : [])))];
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
  };
  const last = entries.at(-1);
  return {
    lines: entries.flatMap((entry) => {
      const line = describeProjectActivity(entry, context);
      return line ? [line] : [];
    }),
    next: entries.length === ACTIVITY_PAGE && last ? { at: last.at, id: last.id } : null,
  };
}
