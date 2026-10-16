"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EyeIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { templateMatches } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Button } from "@/core/ui/primitives/button";
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const matches = (template: DeliverableTemplate) =>
    templateMatches(query, [
      template.name,
      ...template.stageGroups.flatMap((group) => group.label ?? []),
    ]);
  const all = templates.filter((template) => !template.archived);
  const active = all.filter(matches);
  const archived = templates.filter((template) => template.archived && matches(template));
  const previewing = templates.find((template) => template.id === previewId) ?? null;

  function line(template: DeliverableTemplate): string {
    const author =
      template.createdBy === viewer.id ? "by you" : `by ${names[template.createdBy] ?? "someone"}`;
    return [groupsSummary(template.stageGroups), author].join(" · ");
  }

  async function restore(template: DeliverableTemplate) {
    setBusyId(template.id);
    toastResult(await restoreDeliverableTemplate({ templateId: template.id }), {
      success: `Restored ${template.name}: + Add deliverable offers it again`,
    });
    setBusyId(null);
  }

  const addButton = (
    <Button
      variant="secondary"
      className="min-h-11"
      onClick={() => setAdding(true)}
      data-slot="add-deliverable-template"
      aria-label="Add a deliverable template"
    >
      <PlusIcon aria-hidden />
      Add
    </Button>
  );

  return (
    <section aria-labelledby="deliverable-templates" className="flex flex-col gap-3">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="deliverable-templates" className="text-sm font-semibold">
          Deliverable templates
        </h2>
        {/* With none yet, the empty state holds the one Add (one obvious next action). */}
        {all.length > 0 ? addButton : null}
      </div>
      {all.length === 0 ? (
        <EmptyState
          icon={PackageIcon}
          size="compact"
          title="No deliverable templates yet"
          description="Add one for a deliverable you repeat. Save as template on a deliverable makes one too."
          action={addButton}
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
                <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    aria-label={`Preview ${template.name}`}
                    title={`See the stages a deliverable made from ${template.name} starts with`}
                    onClick={() => setPreviewId(template.id)}
                  >
                    <EyeIcon aria-hidden />
                    Preview
                  </Button>
                  {allowed.edit ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={`Edit ${template.name}`}
                      title={`Edit ${template.name}`}
                      onClick={() => setEditing(template)}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                  ) : null}
                  {allowed.archive ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={`Archive ${template.name}`}
                      title={`Archive ${template.name}`}
                      onClick={() => setArchiving(template)}
                    >
                      <ArchiveIcon aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {archived.length > 0 ? (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {archived.map((template) => (
            <li
              key={template.id}
              data-slot="archived-deliverable-template"
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
            >
              <div className={cn("flex min-w-0 flex-col gap-0.5", CARD_ROW_TITLE)}>
                <span className="text-muted-foreground truncate text-sm">
                  {template.name} (archived)
                </span>
                {template.archivedReason ? (
                  <span className="text-muted-foreground text-xs break-words">
                    {template.archivedReason}
                  </span>
                ) : null}
              </div>
              {templateRowActions(template, viewer).restore ? (
                <Button
                  type="button"
                  variant="ghost"
                  className={cn("min-h-11", CARD_ROW_TRAILING)}
                  aria-label={`Restore ${template.name}`}
                  disabled={busyId !== null}
                  onClick={() => void restore(template)}
                >
                  <ArchiveRestoreIcon aria-hidden />
                  Restore
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
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
        title={`Archive ${archiving?.name ?? "this template"}?`}
        description="“+ Add deliverable” stops offering it. Deliverables made from it keep their stages."
        label="Why archive it"
        submitLabel={`Archive ${archiving?.name ?? "template"}`}
        destructive
        onSubmit={async (reason) =>
          archiving
            ? toastResult(await archiveDeliverableTemplate({ templateId: archiving.id, reason }), {
                success: `Archived ${archiving.name}: + Add deliverable no longer offers it`,
              })
            : false
        }
      />
    </section>
  );
}
