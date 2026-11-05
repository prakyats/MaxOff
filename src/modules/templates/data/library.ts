import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { stagePresetsFrom, type StagePresetRow } from "@/modules/settings";
import {
  taskTemplatesFrom,
  taskTypesFrom,
  type TaskTemplateRow,
  type TaskTypeRow,
} from "@/modules/tasks";

import { type DeliverableTemplateRow, deliverableTemplatesFrom } from "./deliverable-templates";
import { type ProjectTemplateRow, projectTemplatesFrom } from "./project-templates";

/**
 * Settings → Templates' five template lists in one read (v2.0 X3, `templates_library()`;
 * ARCHITECTURE §19): each key exactly the rows its own read returns (`listTaskTemplates`,
 * `listTaskTypes`, `listProjectTemplates`, `listDeliverableTemplates`, `listStagePresets`: the
 * same columns, filter and order), under the same RLS (security invoker), mapped by each module's
 * own mapper so the page gets what those reads gave it.
 */
export async function readTemplatesLibrary() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("templates_library");
  if (error) throw error;
  const library = data as {
    task_templates: TaskTemplateRow[];
    task_types: TaskTypeRow[];
    project_templates: ProjectTemplateRow[];
    deliverable_templates: DeliverableTemplateRow[];
    stage_presets: StagePresetRow[];
  };
  return {
    taskTemplates: taskTemplatesFrom(library.task_templates),
    taskTypes: taskTypesFrom(library.task_types),
    projectTemplates: projectTemplatesFrom(library.project_templates),
    deliverableTemplates: deliverableTemplatesFrom(library.deliverable_templates),
    stagePresets: stagePresetsFrom(library.stage_presets),
  };
}
