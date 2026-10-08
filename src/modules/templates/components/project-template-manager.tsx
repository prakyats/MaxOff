"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  FolderKanbanIcon,
  PencilIcon,
  PlusIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

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
 * the Owner any. A template holds a repeat, stages (from a preset or typed), an item list, a
 * description and the project fields' defaults; **never a billing category** (amendment C: money is
 * the Owner's, phase 9). New project offers it under Start from. Rows in the list-manager shape,
 * beside the task templates' group.
 */
export function ProjectTemplateManager({
  templates,
  ...context
}: Context & { templates: readonly ProjectTemplate[] }) {
  const [editing, setEditing] = useState<ProjectTemplate | null>(null);
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<ProjectTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = templates.filter((template) => !template.archived);
  const archived = templates.filter((template) => template.archived);

  function line(template: ProjectTemplate): string {
    const author =
      template.createdBy === context.viewer.id
        ? "by you"
        : `by ${context.names[template.createdBy] ?? "someone"}`;
    return [
      RECURRENCE_LABELS[template.recurrence],
      template.stages.length > 0 ? `${template.stages.length} stages` : null,
      template.items.length === 1 ? "1 item" : `${template.items.length} items`,
      author,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function restore(template: ProjectTemplate) {
    setBusyId(template.id);
    toastResult(await setProjectTemplateArchived({ templateId: template.id, archived: false }), {
      success: "Template restored",
    });
    setBusyId(null);
  }

  return (
    <section aria-labelledby="project-templates" className="flex flex-col gap-3">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="project-templates" className="text-sm font-semibold">
          Project templates
        </h2>
        <Button
          variant="secondary"
          onClick={() => setAdding(true)}
          data-slot="add-project-template"
        >
          <PlusIcon aria-hidden />
          Add project template
        </Button>
      </div>
      {active.length === 0 ? (
        <EmptyState
          icon={FolderKanbanIcon}
          size="compact"
          title="No project templates yet"
          description="Add one for a retainer you run for several clients. New project offers it."
        />
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
                {allowed.edit ? (
                  <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${template.name}`}
                      onClick={() => setEditing(template)}
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Archive ${template.name}`}
                      onClick={() => setArchiving(template)}
                    >
                      <ArchiveIcon aria-hidden />
                    </Button>
                  </div>
                ) : null}
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
              data-slot="archived-project-template"
              className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
            >
              <span className={cn("text-muted-foreground truncate text-sm", CARD_ROW_TITLE)}>
                {template.name} (archived)
              </span>
              {projectTemplateActions(template, context.viewer).restore ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={CARD_ROW_TRAILING}
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
      {adding ? <TemplateDialog {...context} onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <TemplateDialog
          key={editing.id}
          template={editing}
          {...context}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {archiving ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setArchiving(null);
          }}
          title={`Archive ${archiving.name}?`}
          description="New project stops offering it. Projects made from it keep what it gave them."
          confirmLabel={`Archive ${archiving.name}`}
          pendingLabel="Archiving…"
          onConfirm={async () =>
            toastResult(
              await setProjectTemplateArchived({ templateId: archiving.id, archived: true }),
              { success: "Template archived" },
            )
          }
        />
      ) : null}
    </section>
  );
}
