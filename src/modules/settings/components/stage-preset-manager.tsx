"use client";

import { ListOrderedIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { templateMatches } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ListAddButton, ListHeading, ListRowActions } from "@/core/ui/composites/list-rows";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
import { TemplateDeleteDialog } from "@/core/ui/composites/template-delete-dialog";
import { toastResult } from "@/core/ui/toast";

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
 * Archive (D6; named Archive again, owner 2026-10-21) has Undo in the toast; no Archived list. "Add preset" sits on the list's heading (C4); each row's
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
  const all = presets.filter((preset) => !preset.archived);
  const active = all.filter((preset) => templateMatches(query, [preset.name, ...preset.stages]));

  const author = (preset: StagePreset) =>
    preset.createdBy === null
      ? "built in"
      : preset.createdBy === viewer.id
        ? "by you"
        : `by ${names[preset.createdBy] ?? "someone"}`;

  async function restore(preset: StagePreset) {
    toastResult(await setStagePresetArchived({ presetId: preset.id, archived: false }));
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
                    <span className="truncate text-sm font-medium">{preset.name}</span>
                    <span className="text-muted-foreground text-xs break-words">
                      {stagesLine(preset.stages)} · {author(preset)}
                    </span>
                  </div>
                  {allowed.edit ? (
                    <ListRowActions
                      name={preset.name}
                      kind="Stage preset"
                      slot="stage-preset-actions"
                      edit={{ label: "Edit", onSelect: () => setEditing(preset) }}
                      onArchive={() => setArchiving(preset)}
                      onDelete={viewer.role === "owner" ? () => setDeleting(preset) : undefined}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
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
    </div>
  );
}
