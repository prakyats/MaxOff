"use client";

import { FolderKanbanIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { countDeliverables, templateMatches } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ListAddButton, ListRowActions } from "@/core/ui/composites/list-rows";
import { TemplateDeleteDialog } from "@/core/ui/composites/template-delete-dialog";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
import { TemplatePreviewDialog } from "@/core/ui/stage-groups/template-preview-dialog";
import { toastResult } from "@/core/ui/toast";

import { deleteProjectTemplate, projectTemplateUsage } from "../actions/delete";
import { setProjectTemplateArchived } from "../actions/project-templates";
import {
  projectTemplateActions,
  type ProjectTemplate,
  type TemplateRecurrence,
} from "../domain/project-templates";

import type { ProjectTemplateContext } from "./project-template-dialog";

/** The form loads when it first opens (ARCHITECTURE §19). */
const TemplateDialog = dynamic(
  () => import("./project-template-dialog").then((module) => module.ProjectTemplateDialog),
  { ssr: false },
);

const RECURRENCE_LABELS: Record<TemplateRecurrence, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  one_time: "One-time",
};
type Context = ProjectTemplateContext;

/**
 * Settings → Templates → **Project templates** (7.4; PRODUCT §4.5, §4.16; kickoff 7 decision 23,
 * PERMISSIONS ⁴): shared company-wide (`templates.manage`); an Admin edits and archives their own,
 * the Owner any. A template holds a repeat, default stage groups, deliverables each with their
 * own stage groups (6b), a description and the project fields' defaults; **never a billing category** (amendment C: money is
 * the Owner's, phase 9). New project offers it under Start from. Rows in the list-manager shape,
 * beside the task templates' group.
 */
export function ProjectTemplateManager({
  templates,
  query = "",
  ...context
}: Context & {
  templates: readonly ProjectTemplate[];
  /** The page's search (6b.16 (f)): a name or a deliverable's title; a view control. */
  query?: string;
}) {
  const [editing, setEditing] = useState<ProjectTemplate | null>(null);
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<ProjectTemplate | null>(null);
  // The Owner's permanent Delete (V5a 6b): any template, any time.
  const [deleting, setDeleting] = useState<ProjectTemplate | null>(null);
  const isOwner = context.viewer.role === "owner";
  const [previewId, setPreviewId] = useState<string | null>(null);
  const matches = (template: ProjectTemplate) =>
    templateMatches(query, [
      template.name,
      ...template.deliverables.map((deliverable) => deliverable.title),
    ]);
  const all = templates.filter((template) => !template.archived);
  const active = all.filter(matches);
  const previewing = templates.find((template) => template.id === previewId) ?? null;

  function line(template: ProjectTemplate): string {
    const author =
      template.createdBy === context.viewer.id
        ? "by you"
        : `by ${context.names[template.createdBy] ?? "someone"}`;
    // What a project made from it gets (6b.16 (a)): "6 deliverables · 72 stages".
    const counts = countDeliverables(template.deliverables, template.stageGroups);
    return [
      RECURRENCE_LABELS[template.recurrence],
      counts.deliverables === 1 ? "1 deliverable" : `${counts.deliverables} deliverables`,
      counts.stages === 1 ? "1 stage" : `${counts.stages} stages`,
      author,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function restore(template: ProjectTemplate) {
    toastResult(await setProjectTemplateArchived({ templateId: template.id, archived: false }));
  }

  const addButton = (
    <ListAddButton onClick={() => setAdding(true)} data-slot="add-project-template">
      Add project template
    </ListAddButton>
  );

  return (
    <section aria-labelledby="project-templates" className="flex flex-col gap-3">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="project-templates" className="text-sm font-semibold">
          Project templates
        </h2>
        {addButton}
      </div>
      {all.length === 0 ? (
        <EmptyState
          icon={FolderKanbanIcon}
          size="compact"
          title="No project templates yet"
          description="Add one to start projects faster. Save as template on a project makes one too."
        />
      ) : active.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-slot="project-templates-none">
          No project template matches “{query.trim()}”.
        </p>
      ) : (
        <ul
          data-slot="project-templates"
          className="border-border divide-border divide-y rounded-lg border"
        >
          {active.map((template) => {
            const allowed = projectTemplateActions(template, context.viewer);
            return (
              <li
                key={template.id}
                data-slot="project-template"
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
                  kind="Project template"
                  slot="project-template-actions"
                  preview={{
                    onSelect: () => setPreviewId(template.id),
                    title: `See what a project started from ${template.name} gets`,
                  }}
                  edit={
                    allowed.edit
                      ? { label: "Edit", onSelect: () => setEditing(template) }
                      : undefined
                  }
                  onArchive={allowed.edit ? () => setArchiving(template) : undefined}
                  onDelete={isOwner ? () => setDeleting(template) : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
      {adding ? <TemplateDialog {...context} onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <TemplateDialog
          key={editing.id}
          template={editing}
          {...context}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <TemplatePreviewDialog
        open={previewing !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
        name={previewing?.name ?? ""}
        description="What a project started from it gets."
        deliverables={previewing?.deliverables ?? []}
        defaults={previewing?.stageGroups ?? []}
      />
      {archiving ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setArchiving(null);
          }}
          title={`Archive ${archiving.name}?`}
          description="It won't be offered for new projects. Projects already made from it don't change."
          confirmLabel={`Archive ${archiving.name}`}
          pendingLabel="Archiving…"
          onConfirm={async () => {
            const template = archiving;
            toastResult(
              await setProjectTemplateArchived({ templateId: template.id, archived: true }),
              { success: `${template.name} archived`, undo: () => void restore(template) },
            );
          }}
        />
      ) : null}
      {deleting ? (
        <TemplateDeleteDialog
          key={deleting.id}
          kind="project"
          name={deleting.name}
          loadUsage={() => projectTemplateUsage({ templateId: deleting.id })}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={async () => {
            const template = deleting;
            toastResult(await deleteProjectTemplate({ templateId: template.id }), {
              success: `${template.name} deleted`,
            });
          }}
        />
      ) : null}
    </section>
  );
}
