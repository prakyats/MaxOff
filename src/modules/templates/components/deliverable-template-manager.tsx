"use client";

import { PackageIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { templateMatches } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { EmptyState } from "@/core/ui/composites/empty-state";
import {
  ArchivedRow,
  ArchivedSection,
  ListAddButton,
  ListRowActions,
} from "@/core/ui/composites/list-rows";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
import { TemplateDeleteDialog } from "@/core/ui/composites/template-delete-dialog";
import { type StagePresetOption, groupsSummary } from "@/core/ui/stage-groups/editing";
import { TemplatePreviewDialog } from "@/core/ui/stage-groups/template-preview-dialog";
import { toastResult } from "@/core/ui/toast";

import { deleteDeliverableTemplate } from "../actions/delete";
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
  // The Owner's permanent Delete (V5a 6b): any template, any time.
  const [deleting, setDeleting] = useState<DeliverableTemplate | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const matches = (template: DeliverableTemplate) =>
    templateMatches(query, [
      template.name,
      ...template.stageGroups.flatMap((group) => group.label ?? []),
    ]);
  const all = templates.filter((template) => !template.archived);
  const active = all.filter(matches);
  // V5b-0 item 9: the archived ones the viewer may restore, at the list's foot.
  const archived = templates.filter(
    (template) =>
      template.archived && templateRowActions(template, viewer).restore && matches(template),
  );
  const previewing = templates.find((template) => template.id === previewId) ?? null;

  function line(template: DeliverableTemplate): string {
    const author =
      template.createdBy === viewer.id ? "by you" : `by ${names[template.createdBy] ?? "someone"}`;
    // PP-admin-12: one the viewer cannot change says so, and keeps Preview.
    const viewOnly = templateRowActions(template, viewer).edit ? null : "view only";
    return [groupsSummary(template.stageGroups), author, viewOnly].filter(Boolean).join(" · ");
  }

  async function restore(template: DeliverableTemplate) {
    toastResult(await restoreDeliverableTemplate({ templateId: template.id }), {
      success: `${template.name} restored`,
    });
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
          className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border"
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
                  <span className="text-sm font-medium break-words">{template.name}</span>
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
                  onArchive={allowed.archive ? () => setArchiving(template) : undefined}
                  onDelete={viewer.role === "owner" ? () => setDeleting(template) : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
      <ArchivedSection count={archived.length}>
        {archived.map((template) => (
          <ArchivedRow
            key={template.id}
            name={template.name}
            meta={line(template)}
            kind="Deliverable template"
            onRestore={() => void restore(template)}
            onDelete={viewer.role === "owner" ? () => setDeleting(template) : undefined}
          />
        ))}
      </ArchivedSection>
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
        description="It won't be offered for new deliverables. Deliverables already made from it don't change."
        label="Why archive it"
        submitLabel={`Archive ${archiving?.name ?? "template"}`}
        onSubmit={async (reason) => {
          // Archive (D6; named Archive again, owner 2026-10-21) with its reason (invariant 9): the
          // neutral commit, archive is never red; Undo in the toast.
          const template = archiving;
          return template
            ? toastResult(await archiveDeliverableTemplate({ templateId: template.id, reason }), {
                success: `${template.name} archived`,
                undo: () => void restore(template),
              })
            : false;
        }}
      />
      {deleting ? (
        <TemplateDeleteDialog
          key={deleting.id}
          kind="deliverable"
          name={deleting.name}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={async () => {
            const template = deleting;
            toastResult(await deleteDeliverableTemplate({ templateId: template.id }), {
              success: `${template.name} deleted`,
            });
          }}
        />
      ) : null}
    </section>
  );
}
