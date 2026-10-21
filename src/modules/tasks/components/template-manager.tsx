"use client";

import { LayoutTemplateIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { templateMatches } from "@/core/lib/stage-groups";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ListAddButton, ListHeading, ListRowActions } from "@/core/ui/composites/list-rows";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
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
  query = "",
  ...context
}: Context & {
  templates: readonly TaskTemplate[];
  /** The Templates page's one search (6b.6 owner note): a name or a stage; a view control. */
  query?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [archiving, setArchiving] = useState<TaskTemplate | null>(null);
  const all = templates.filter((template) => !template.archived);
  const active = all
    .filter((template) => templateMatches(query, [template.name, ...template.stages]))
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
    toastResult(await setTemplateArchived({ templateId: template.id, archived: false }));
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
        {all.length === 0 ? (
          <EmptyState
            icon={LayoutTemplateIcon}
            size="compact"
            title="No task templates yet"
            description="Add one for work that repeats. New task offers it under Start from."
          />
        ) : active.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-slot="task-templates-none">
            No task template matches “{query.trim()}”.
          </p>
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
                      onDelete={() => setArchiving(template)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
          title={`Delete ${archiving.name}?`}
          description="It won't be offered for new tasks. Tasks already made from it don't change."
          confirmLabel={`Delete ${archiving.name}`}
          pendingLabel="Deleting…"
          onConfirm={async () => {
            const template = archiving;
            toastResult(await setTemplateArchived({ templateId: template.id, archived: true }), {
              success: `${template.name} deleted`,
              undo: () => void restore(template),
            });
          }}
        />
      ) : null}
    </section>
  );
}
