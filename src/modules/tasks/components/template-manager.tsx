"use client";

import { ArchiveRestoreIcon, LayoutTemplateIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ListAddButton, ListHeading, ListRowActions } from "@/core/ui/composites/list-rows";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { setTemplateArchived } from "../actions/templates";
import { templateActions, type TaskTemplate } from "../domain/templates";
import { PRIORITY_LABELS } from "../domain/types";
import type { TemplateContext } from "./template-dialog";

/** The form (selects, stages, the task fields' defaults) loads when it first opens (§19). */
const TemplateDialog = dynamic(
  () => import("./template-dialog").then((module) => module.TemplateDialog),
  { ssr: false },
);

type Context = TemplateContext;

/**
 * Settings → Templates (4.6; PRODUCT §4.6, WORKFLOWS §3.5, Kickoff 4 decision 19): task
 * templates, shared company-wide. Everyone with `templates.manage` (the Owner and Admins) adds one
 * and uses any in "New task → Start from"; an Admin edits and archives the ones they made, the
 * Owner any. A template holds a type, a priority, a description, stages and the task fields'
 * defaults; never a client, people or a deadline. Rows in the list-manager shape (1.4): "Add task
 * template" on the heading (C4) and each row's `ListRowActions`.
 */
export function TemplateManager({
  templates,
  ...context
}: Context & { templates: readonly TaskTemplate[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [archiving, setArchiving] = useState<TaskTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const active = templates
    .filter((template) => !template.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const archived = templates
    .filter((template) => template.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const typeName = new Map(context.types.map((type) => [type.id, type.name]));

  function line(template: TaskTemplate): string {
    const stages =
      template.stages.length === 0
        ? null
        : template.stages.length === 1
          ? "1 stage"
          : `${template.stages.length} stages`;
    const author =
      template.createdBy === context.viewer.id
        ? "by you"
        : `by ${context.names[template.createdBy] ?? "someone"}`;
    return [
      typeName.get(template.taskTypeId) ?? "A task type",
      PRIORITY_LABELS[template.defaultPriority],
      stages,
      author,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function restore(template: TaskTemplate) {
    setBusyId(template.id);
    toastResult(await setTemplateArchived({ templateId: template.id, archived: false }), {
      success: "Template restored",
    });
    setBusyId(null);
  }

  return (
    <section aria-labelledby="task-templates" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <ListHeading
          id="task-templates"
          title="Task templates"
          action={
            <ListAddButton onClick={() => setAdding(true)} data-slot="add-template">
              Add task template
            </ListAddButton>
          }
        />
        {active.length === 0 ? (
          <EmptyState
            icon={LayoutTemplateIcon}
            title="No templates yet"
            description="Add one for work that repeats. New task offers it under Start from."
          />
        ) : (
          <ul
            data-slot="task-templates"
            className="border-border divide-border divide-y rounded-lg border"
          >
            {active.map((template) => {
              const allowed = templateActions(template, context.viewer);
              return (
                <li
                  key={template.id}
                  data-slot="task-template"
                  className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
                >
                  <div className={cn("flex min-w-0 flex-col gap-0.5", CARD_ROW_TITLE)}>
                    <span className="truncate text-sm font-medium">{template.name}</span>
                    <span className="text-muted-foreground text-xs break-words">
                      {line(template)}
                    </span>
                  </div>
                  {allowed.edit ? (
                    <ListRowActions
                      name={template.name}
                      kind="Template"
                      slot="task-template-actions"
                      edit={{ label: "Edit", onSelect: () => setEditing(template) }}
                      onArchive={() => setArchiving(template)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {archived.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-sm font-medium">Archived</h2>
          <p className="text-muted-foreground text-sm">
            Not offered in New task. Tasks made from one keep what it gave them.
          </p>
          <ul
            data-slot="archived-task-templates"
            className="border-border divide-border divide-y rounded-lg border"
          >
            {archived.map((template) => (
              <li
                key={template.id}
                data-slot="archived-task-template"
                className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
              >
                <span className={cn("text-muted-foreground truncate text-sm", CARD_ROW_TITLE)}>
                  {template.name}
                </span>
                {templateActions(template, context.viewer).restore ? (
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
        </section>
      ) : null}

      {adding ? <TemplateDialog key="add" {...context} onClose={() => setAdding(false)} /> : null}
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
          description="New task stops offering it. Tasks made from it keep what it gave them, and you can restore it later."
          confirmLabel={`Archive ${archiving.name}`}
          pendingLabel="Archiving…"
          onConfirm={async () =>
            toastResult(await setTemplateArchived({ templateId: archiving.id, archived: true }), {
              success: "Template archived",
            })
          }
        />
      ) : null}
    </section>
  );
}
