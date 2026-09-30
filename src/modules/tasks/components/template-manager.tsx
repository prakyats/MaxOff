"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  LayoutTemplateIcon,
  MoreHorizontalIcon,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/ui/primitives/sheet";
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
 * defaults; never a client, people or a deadline. Rows in the list-manager shape (1.4).
 */
export function TemplateManager({
  templates,
  ...context
}: Context & { templates: readonly TaskTemplate[] }) {
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
    <div className="flex flex-col gap-6">
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
                  <div className={cn("flex items-center", CARD_ROW_TRAILING)}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${template.name}`}
                      onClick={() => setEditing(template)}
                      className="hidden md:inline-flex"
                    >
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      aria-label={`Archive ${template.name}`}
                      onClick={() => setArchiving(template)}
                      className="hidden md:inline-flex"
                    >
                      <ArchiveIcon aria-hidden />
                    </Button>
                    <RowSheet
                      name={template.name}
                      onEdit={() => setEditing(template)}
                      onArchive={() => setArchiving(template)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

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
    </div>
  );
}

/** Edit and Archive on a phone (1.5's shape). */
function RowSheet({
  name,
  onEdit,
  onArchive,
}: {
  name: string;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  function choose(then: () => void) {
    setOpen(false);
    then();
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${name}`}
          className="md:hidden"
        >
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        data-slot="task-template-actions"
        className="gap-3 rounded-t-2xl pb-[calc(1.5rem+var(--app-safe-bottom))]"
      >
        <div
          aria-hidden
          className="bg-border pointer-events-none absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full"
        />
        <SheetHeader className="pt-3 pr-12 pb-0">
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription className="sr-only">Template actions</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4">
          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={() => choose(onEdit)}
          >
            <PencilIcon aria-hidden />
            Edit
          </Button>
          <Button
            variant="destructive"
            className="w-full justify-start"
            onClick={() => choose(onArchive)}
          >
            <ArchiveIcon aria-hidden />
            Archive
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The screen's one primary action, for `PageHeader` (a FAB on a phone). */
export function AddTemplateButton(context: Context) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="strong" onClick={() => setOpen(true)} data-slot="add-template">
        <PlusIcon aria-hidden />
        Add template
      </Button>
      {open ? <TemplateDialog {...context} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
