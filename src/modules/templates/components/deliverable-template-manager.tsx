"use client";

import { PackageIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { templateMatches } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ListAddButton, ListRowActions } from "@/core/ui/composites/list-rows";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
import { type StagePresetOption, groupsSummary } from "@/core/ui/stage-groups/editing";
import { TemplatePreviewDialog } from "@/core/ui/stage-groups/template-preview-dialog";
import { toastResult } from "@/core/ui/toast";

import {
  archiveDeliverableTemplate,
  restoreDeliverableTemplate,
} from "../actions/deliverable-templates";
import { type DeliverableTemplate, templateRowActions } from "../domain/deliverable-templates";

/** The form loads when it first opens (ARCHITECTURE §19). */
const TemplateDialog = dynamic(
  () => import("./deliverable-template-dialog").then((module) => module.DeliverableTemplateDialog),
  { ssr: false },
);

/**
 * Settings → Templates → **Deliverable templates** (6b Release 2; ROADMAP 6b.13 (2), 6b.16;
 * PERMISSIONS ⁴): a reusable deliverable, its name and stage groups, shared company-wide
 * (`templates.manage`); an Admin edits and archives their own (with a reason), the Owner any.
 * "+ Add deliverable" on a project and the builders' "Add deliverables" row offer them; "Save as
 * template" on a deliverable makes one. Each row has a **Preview** (a layer, §14.2 a). `query` is
 * the page's search (name or stage group), filtering the list without adding history.
 */
export function DeliverableTemplateManager({
  templates,
  presets,
  viewer,
  names,
  query,
}: {
  templates: readonly DeliverableTemplate[];
  presets: readonly StagePresetOption[];
  viewer: { id: string; role: string };
  names: Readonly<Record<string, string>>;
  query: string;
}) {
  const [editing, setEditing] = useState<DeliverableTemplate | null>(null);
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<DeliverableTemplate | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const matches = (template: DeliverableTemplate) =>
    templateMatches(query, [
      template.name,
      ...template.stageGroups.flatMap((group) => group.label ?? []),
    ]);
  const all = templates.filter((template) => !template.archived);
  const active = all.filter(matches);
  const previewing = templates.find((template) => template.id === previewId) ?? null;

  function line(template: DeliverableTemplate): string {
    const author =
      template.createdBy === viewer.id ? "by you" : `by ${names[template.createdBy] ?? "someone"}`;
    return [groupsSummary(template.stageGroups), author].join(" · ");
  }

  async function restore(template: DeliverableTemplate) {
    toastResult(await restoreDeliverableTemplate({ templateId: template.id }));
  }

  const addButton = (
    <ListAddButton onClick={() => setAdding(true)} data-slot="add-deliverable-template">
      Add deliverable template
    </ListAddButton>
  );

  return (
    <section aria-labelledby="deliverable-templates" className="flex flex-col gap-3">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="deliverable-templates" className="text-sm font-semibold">
          Deliverable templates
        </h2>
        {addButton}
      </div>
      {all.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          size="compact"
          title="No deliverable templates yet"
          description="Add one for a deliverable you repeat. Save as template on a deliverable makes one too."
        />
      ) : active.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-slot="deliverable-templates-none">
          No deliverable template matches “{query.trim()}”.
        </p>
      ) : (
        <ul
          data-slot="deliverable-templates"
          className="border-border divide-border divide-y rounded-lg border"
        >
          {active.map((template) => {
            const allowed = templateRowActions(template, viewer);
            return (
              <li
                key={template.id}
                data-slot="deliverable-template"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <div className={cn("flex min-w-0 flex-col gap-0.5", CARD_ROW_TITLE)}>
                  <span className="truncate text-sm font-medium">{template.name}</span>
                  <span className="text-muted-foreground text-xs break-words">
                    {line(template)}
                  </span>
                </div>
                <ListRowActions
                  name={template.name}
                  kind="Deliverable template"
                  slot="deliverable-template-actions"
                  preview={{
                    onSelect: () => setPreviewId(template.id),
                    title: `See the stages a deliverable made from ${template.name} starts with`,
                  }}
                  edit={
                    allowed.edit
                      ? { label: "Edit", onSelect: () => setEditing(template) }
                      : undefined
                  }
                  onDelete={allowed.archive ? () => setArchiving(template) : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
      {adding ? <TemplateDialog presets={presets} onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <TemplateDialog
          key={editing.id}
          template={editing}
          presets={presets}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <TemplatePreviewDialog
        open={previewing !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
        name={previewing?.name ?? ""}
        description="What a deliverable made from it starts with."
        deliverables={
          previewing ? [{ title: previewing.name, stageGroups: previewing.stageGroups }] : []
        }
        defaults={[]}
      />
      <ReasonDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={`Delete ${archiving?.name ?? "this template"}?`}
        description="It won't be offered for new deliverables. Deliverables already made from it don't change."
        label="Why delete it"
        submitLabel={`Delete ${archiving?.name ?? "template"}`}
        destructive
        onSubmit={async (reason) => {
          // D6: Delete is the archive (with its reason, invariant 9); a final-looking action, red
          // (owner correction 2026-10-21).
          const template = archiving;
          return template
            ? toastResult(await archiveDeliverableTemplate({ templateId: template.id, reason }), {
                success: `${template.name} deleted`,
                undo: () => void restore(template),
              })
            : false;
        }}
      />
    </section>
  );
}
