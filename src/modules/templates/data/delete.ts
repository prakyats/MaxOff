import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { type TemplateUsage, usageFromJson } from "@/core/lib/owner-delete";

/**
 * The Owner-only Delete of a project or deliverable template (v1.8 V5a 6b; DATA-MODEL §2 "The
 * Owner-only Delete"): `template_usage` / `template_delete` check the Owner, write the history row
 * first and mark the template deleted (and archived). Nothing made from it changes.
 */
export type TemplatesDeleteKind = "project" | "deliverable";

export async function templateUsage(kind: TemplatesDeleteKind, id: string): Promise<TemplateUsage> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("template_usage", { kind, template_id: id });
  if (error) throw error;
  return usageFromJson(data);
}

export async function deleteTemplate(kind: TemplatesDeleteKind, id: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("template_delete", { kind, template_id: id });
  if (error) throw error;
}
