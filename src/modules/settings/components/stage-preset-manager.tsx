"use client";

import { ListOrderedIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { templateMatches } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import {
  ArchivedRow,
  ArchivedSection,
  ListAddButton,
  ListHeading,
  ListRowActions,
} from "@/core/ui/composites/list-rows";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
import { TemplateDeleteDialog } from "@/core/ui/composites/template-delete-dialog";
import { toastResult } from "@/core/ui/toast";

import { TemplatePreviewDialog } from "@/core/ui/stage-groups/template-preview-dialog";

import { deleteStagePreset, setStagePresetArchived } from "../actions/stage-presets";
import { presetActions, stagesLine, type StagePreset } from "../domain/stage-presets";

type Viewer = { id: string; role: string };

/**
 * Add or edit a preset, loaded on the first tap of Add preset or Edit, not with the page (its
 * drag-to-reorder rows and menus, 6b.18, stay out of the first load; ARCHITECTURE §19).
 */
const PresetDialog = dynamic(
  () => import("./stage-preset-dialog").then((module) => module.PresetDialog),
  { ssr: false },
);

/**
 * Settings → Stage presets (7.4; PRODUCT §4.16, kickoff 7 decision 22, PERMISSIONS ⁴): the presets
 * New project offers, shared company-wide. Everyone with `lists.manage` adds one; an Admin edits
 * and archives the ones they made, the Owner any (the seeded one belongs to nobody, so only the
 * Owner). A preset is copied into a project when chosen: changing it never touches a project.
 * Archive (D6; named Archive again, owner 2026-10-21) has Undo in the toast, and the collapsed "Archived (n)" at the list's foot restores it later (V5b-0 item 9). "Add preset" sits on the list's heading (C4); each row's
 * Edit and Archive are `ListRowActions` (icons from `md` up, one ⋯ sheet on a phone), each opening
 * its own layer (§14.2 a).
 */
export function StagePresetManager({
  presets,
  viewer,
  names,
  query = "",
}: {
  presets: readonly StagePreset[];
  viewer: Viewer;
  names: Readonly<Record<string, string>>;
  /** The Templates page's one search (6b.6 owner note): a name or a stage; a view control. */
  query?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StagePreset | null>(null);
  const [archiving, setArchiving] = useState<StagePreset | null>(null);
  // The Owner's permanent Delete (V5a 6b): any preset, any time.
  const [deleting, setDeleting] = useState<StagePreset | null>(null);
  // PP-templates-1: every row has Preview, presets too (one pattern across Templates).
  const [previewId, setPreviewId] = useState<string | null>(null);
  const all = presets.filter((preset) => !preset.archived);
  const active = all.filter((preset) => templateMatches(query, [preset.name, ...preset.stages]));
  // V5b-0 item 9: the archived ones the viewer may restore, at the list's foot.
  const archived = presets.filter(
    (preset) =>
      preset.archived &&
      presetActions(preset, viewer).edit &&
      templateMatches(query, [preset.name, ...preset.stages]),
  );

  // PP-admin-12: one the viewer cannot change says so ("by Ravi · view only").
  const author = (preset: StagePreset) =>
    [
      preset.createdBy === null
        ? "built in"
        : preset.createdBy === viewer.id
          ? "by you"
          : `by ${names[preset.createdBy] ?? "someone"}`,
      presetActions(preset, viewer).edit ? null : "view only",
    ]
      .filter(Boolean)
      .join(" · ");
  const previewing = presets.find((preset) => preset.id === previewId) ?? null;

  async function restore(preset: StagePreset) {
    toastResult(await setStagePresetArchived({ presetId: preset.id, archived: false }), {
      success: `${preset.name} restored`,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="stage-presets-heading" className="flex flex-col gap-3">
        <ListHeading
          id="stage-presets-heading"
          title="Stage presets"
          action={
            <ListAddButton onClick={() => setAdding(true)} data-slot="add-stage-preset">
              Add preset
            </ListAddButton>
          }
        />
        {all.length === 0 ? (
          <EmptyState
            icon={ListOrderedIcon}
            size="compact"
            title="No stage presets yet: make one for steps you repeat."
          />
        ) : active.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-slot="stage-presets-none">
            No stage preset matches “{query.trim()}”.
          </p>
        ) : (
          <ul
            data-slot="stage-presets"
            className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border"
          >
            {active.map((preset) => {
              const allowed = presetActions(preset, viewer);
              return (
                <li
                  key={preset.id}
                  data-slot="stage-preset"
                  className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-4"
                >
                  <div className={cn("flex min-w-0 flex-col gap-0.5", CARD_ROW_TITLE)}>
                    {/* The row opens nothing: the name wraps in full (the truncation rule). */}
                    <span className="text-sm font-medium break-words">{preset.name}</span>
                    <span className="text-muted-foreground text-xs break-words">
                      {stagesLine(preset.stages)} · {author(preset)}
                    </span>
                  </div>
                  <ListRowActions
                    name={preset.name}
                    kind="Stage preset"
                    slot="stage-preset-actions"
                    preview={{
                      onSelect: () => setPreviewId(preset.id),
                      title: `See the stages ${preset.name} adds`,
                    }}
                    edit={
                      allowed.edit
                        ? { label: "Edit", onSelect: () => setEditing(preset) }
                        : undefined
                    }
                    onArchive={allowed.archive ? () => setArchiving(preset) : undefined}
                    onDelete={viewer.role === "owner" ? () => setDeleting(preset) : undefined}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <ArchivedSection count={archived.length}>
          {archived.map((preset) => (
            <ArchivedRow
              key={preset.id}
              name={preset.name}
              meta={`${stagesLine(preset.stages)} · ${author(preset)}`}
              kind="Stage preset"
              onRestore={() => void restore(preset)}
              onDelete={viewer.role === "owner" ? () => setDeleting(preset) : undefined}
            />
          ))}
        </ArchivedSection>
      </section>

      {adding ? <PresetDialog key="add" onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <PresetDialog key={editing.id} preset={editing} onClose={() => setEditing(null)} />
      ) : null}
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
            const preset = archiving;
            toastResult(await setStagePresetArchived({ presetId: preset.id, archived: true }), {
              success: `${preset.name} archived`,
              undo: () => void restore(preset),
            });
          }}
        />
      ) : null}
      {deleting ? (
        <TemplateDeleteDialog
          key={deleting.id}
          kind="stage_preset"
          name={deleting.name}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={async () => {
            const preset = deleting;
            toastResult(await deleteStagePreset({ presetId: preset.id }), {
              success: `${preset.name} deleted`,
            });
          }}
        />
      ) : null}
      <TemplatePreviewDialog
        open={previewing !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
        name={previewing?.name ?? ""}
        description="The stages it adds, as one group."
        deliverables={
          previewing
            ? [
                {
                  title: previewing.name,
                  stageGroups: [{ label: previewing.name, stages: [...previewing.stages] }],
                },
              ]
            : []
        }
        defaults={[]}
      />
    </div>
  );
}
