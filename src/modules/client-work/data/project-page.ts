import "server-only";

import { cache } from "react";

import { definitionsFrom } from "@/core/custom-fields/server";
import type { Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";

import { itemRowsFrom } from "./items";
import {
  type BlueprintRow,
  blueprintsFrom,
  projectDetailsFrom,
  type StageRow,
  stagesFrom,
  toCycle,
  type toProject,
} from "./projects";

/**
 * A project's page's own reads in one (v2.0 X3, `project_page()`; ARCHITECTURE §19): the project
 * with its Details' embeds (`getProject`), its cycles, stages and blueprints, its unfinished items
 * (`listItemRows({states: open, done, projectId})`), the project fields (`listDefinitions`) and
 * the stage presets' rows (the page maps them with settings' own mapper), each exactly as its read
 * gave it, under the same RLS (security invoker). Never money. Not the layout's reads or the tab
 * title: a prefetch reads no page data. `cache()`d per request.
 */
export const readProjectPage = cache(async (projectId: string) => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("project_page", { p_project_id: projectId });
  if (error) throw error;
  const page = data as unknown as {
    project:
      | (Parameters<typeof toProject>[0] & {
          template: { name: string; deleted_at: string | null } | null;
          contact_name: string | null;
        })
      | null;
    cycles: Parameters<typeof toCycle>[0][];
    stages: StageRow[];
    blueprints: BlueprintRow[];
    unfinished: Parameters<typeof itemRowsFrom>[0];
    fields: Tables<"field_definitions">[];
    presets: Pick<
      Tables<"stage_presets">,
      "id" | "name" | "stages" | "archived_at" | "created_by"
    >[];
  };
  const {
    template,
    contact_name: contactName,
    ...row
  } = page.project ?? {
    template: null,
    contact_name: null,
  };
  return {
    project: page.project
      ? projectDetailsFrom(row as Parameters<typeof toProject>[0], template, contactName)
      : null,
    cycles: page.cycles.map(toCycle),
    stages: stagesFrom(page.stages),
    blueprints: blueprintsFrom(page.blueprints),
    unfinished: itemRowsFrom(page.unfinished),
    fields: definitionsFrom(page.fields),
    presetRows: page.presets,
  };
});
