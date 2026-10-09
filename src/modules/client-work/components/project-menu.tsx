"use client";

import { MoreHorizontalIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import type { FieldDefinition } from "@/core/custom-fields";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";

import type { ItemListPeriods } from "../domain/periods";
import type { ProjectState, Recurrence } from "../domain/types";

import type { ListRow } from "./list-editor-sheet";
import type { MenuBlueprint, MenuLayer, MenuProject } from "./project-menu-layers";

/**
 * The menu's dialogs and sheets (the forms, the custom fields, the list editors) load after the
 * page, on the first pick, and stay mounted (ARCHITECTURE §19; the 7B review's S2).
 */
const ProjectMenuLayers = dynamic(
  () => import("./project-menu-layers").then((module) => module.ProjectMenuLayers),
  { ssr: false },
);

type Layer = MenuLayer | null;

/**
 * A project's ⋯ menu (7.3 / 7.4; WORKFLOWS §5.4 items 3, 8, 9, 14, 19; PERMISSIONS "Screens
 * (phase 7)"): **Edit details** (name, description, the one-time delivery date, the project
 * fields), **Stages** and the **Item list** (recurring only) in a sheet, **Start next cycle**
 * (recurring, at most 7 days early) for `projects.manage`; **Complete** (refused while anything is
 * open or done: the dialog says what is left), **Cancel** with a reason (it closes the open and
 * done items) and **Reopen** with a reason (refused on an Inactive client) for `projects.complete`.
 * Each opens its own layer; back closes it (§14.2 a). The function behind each decides again.
 */
export function ProjectMenu({
  project,
  stages,
  blueprints,
  definitions,
  canManage,
  canComplete,
  unfinished,
  nextCycleLabel,
  itemList,
}: {
  project: MenuProject & { state: ProjectState; recurrence: Recurrence };
  stages: readonly ListRow[];
  blueprints: readonly MenuBlueprint[];
  definitions: readonly FieldDefinition[];
  canManage: boolean;
  canComplete: boolean;
  /** How many items of the project are still open or done (complete is refused while any are). */
  unfinished: number;
  /** "November 2026": the period "Start next cycle" would begin, when it may start now. */
  nextCycleLabel: string | null;
  /** The Item list's periods (amendment D4); null on a one-time project. */
  itemList: ItemListPeriods | null;
}) {
  const [layer, setLayer] = useState<Layer>(null);
  const [used, setUsed] = useState(false);
  const working = project.state === "open" || project.state === "in_progress";
  const recurring = project.recurrence !== "one_time";
  const pick = (key: MenuLayer) => {
    setUsed(true);
    setLayer(key);
  };

  const entries = [
    canManage && working ? { key: "edit", label: "Edit details" } : null,
    canManage && working ? { key: "stages", label: "Default stages" } : null,
    canManage && working && recurring ? { key: "items", label: "Item list" } : null,
    canManage && working && recurring && nextCycleLabel
      ? { key: "next", label: `Start ${nextCycleLabel}` }
      : null,
  ].filter((entry): entry is { key: Exclude<Layer, null>; label: string } => entry !== null);
  const lifecycle = [
    canComplete && working ? { key: "complete", label: "Complete project" } : null,
    canComplete && working ? { key: "cancel", label: "Cancel project…" } : null,
    canComplete && !working ? { key: "reopen", label: "Reopen project…" } : null,
  ].filter((entry): entry is { key: Exclude<Layer, null>; label: string } => entry !== null);
  if (entries.length === 0 && lifecycle.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${project.name}`}
            data-slot="project-menu"
            className="size-11 md:size-8"
          >
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {entries.map((entry) => (
            <DropdownMenuItem key={entry.key} onSelect={() => pick(entry.key)}>
              {entry.label}
            </DropdownMenuItem>
          ))}
          {entries.length > 0 && lifecycle.length > 0 ? <DropdownMenuSeparator /> : null}
          {lifecycle.map((entry) => (
            <DropdownMenuItem key={entry.key} onSelect={() => pick(entry.key)}>
              {entry.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {used ? (
        <ProjectMenuLayers
          layer={layer}
          onClose={() => setLayer(null)}
          project={project}
          stages={stages}
          blueprints={blueprints}
          definitions={definitions}
          unfinished={unfinished}
          nextCycleLabel={nextCycleLabel}
          itemList={itemList}
        />
      ) : null}
    </>
  );
}
