"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";

import type { FieldDefinition } from "@/core/custom-fields";
import { AfterPage } from "@/core/ui/lazy/after-page";
import { menuStandInPress } from "@/core/ui/lazy/menu-stand-in";

import type { ItemListPeriods } from "../domain/periods";
import type { ProjectState, Recurrence } from "../domain/types";

import type { StagePresetOption } from "@/core/ui/stage-groups/editing";

import type { GroupedStageRow } from "./grouped-stages-sheet";
import type { MenuEntry } from "./project-menu-dropdown";
import type { MenuBlueprint, MenuLayer, MenuProject } from "./project-menu-layers";
import { ProjectMenuTrigger } from "./project-menu-trigger";

/**
 * The dropdown itself (the Radix menu) loads **after the page** (ARCHITECTURE §19): until it
 * arrives the same ⋯ button stands in, and a tap on it opens the menu as soon as the code is
 * there (`menuStandInPress`, the pattern of `UserMenu` and `ThemeToggle`).
 */
const loadDropdown = () =>
  import("./project-menu-dropdown").then((module) => module.ProjectMenuDropdown);

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
 * (recurring, at most 7 days early) and **Save as template** (any state; 6b Release 2: a copy as a
 * project template, the project unchanged) for `projects.manage`; **Complete** (refused while anything is
 * open or done: the dialog says what is left), **Cancel** with a reason (it closes the open and
 * done items) and **Reopen** with a reason (refused on an Inactive client) for `projects.complete`.
 * **Copy schedule as text** (6b.16 (g), in any state) puts the shown cycle's deliverables on the
 * clipboard as plain text for WhatsApp (`scheduleText`, built on the server), with a toast.
 * Each opens its own layer; back closes it (§14.2 a). The function behind each decides again.
 */
export function ProjectMenu({
  project,
  stages,
  blueprints,
  presets,
  definitions,
  canManage,
  canComplete,
  unfinished,
  nextCycleLabel,
  itemList,
  schedule = null,
}: {
  /** The shown cycle's schedule as text ("Copy schedule as text"); null: no cycle. */
  schedule?: string | null;
  project: MenuProject & { state: ProjectState; recurrence: Recurrence };
  stages: readonly GroupedStageRow[];
  blueprints: readonly MenuBlueprint[];
  /** The stage presets ("Add from a preset" adds one as a group, 6b). */
  presets: readonly StagePresetOption[];
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
  const [wanted, setWanted] = useState(false);
  const working = project.state === "open" || project.state === "in_progress";
  const recurring = project.recurrence !== "one_time";
  const pick = (key: MenuLayer) => {
    setUsed(true);
    setLayer(key);
  };

  const entries = [
    canManage && working ? { key: "edit", label: "Edit details" } : null,
    canManage && working ? { key: "stages", label: "Default stages" } : null,
    canManage && working && recurring ? { key: "items", label: "Deliverables list" } : null,
    canManage && working && recurring && nextCycleLabel
      ? { key: "next", label: `Start ${nextCycleLabel}` }
      : null,
    // 6b Release 2: in any state, a well-set-up project becomes the next one's starting point.
    canManage ? { key: "template", label: "Save as template" } : null,
  ].filter((entry): entry is MenuEntry => entry !== null);
  const lifecycle = [
    canComplete && working ? { key: "complete", label: "Complete project" } : null,
    canComplete && working ? { key: "cancel", label: "Cancel project…" } : null,
    canComplete && !working ? { key: "reopen", label: "Reopen project…" } : null,
  ].filter((entry): entry is MenuEntry => entry !== null);
  if (entries.length === 0 && lifecycle.length === 0 && schedule === null) return null;

  async function copySchedule(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Schedule copied: paste it into WhatsApp");
    } catch {
      toast.error("The schedule could not be copied", {
        description: "This browser did not allow it. Try again, or copy from a laptop.",
      });
    }
  }

  return (
    <>
      <AfterPage
        load={loadDropdown}
        props={{
          name: project.name,
          entries,
          lifecycle,
          onPick: pick,
          onCopySchedule: schedule !== null ? () => void copySchedule(schedule) : null,
          defaultOpen: wanted,
        }}
        fallback={
          <ProjectMenuTrigger
            name={project.name}
            aria-haspopup="menu"
            aria-expanded={false}
            data-state="closed"
            {...menuStandInPress(() => setWanted(true))}
          />
        }
      />

      {used ? (
        <ProjectMenuLayers
          layer={layer}
          onClose={() => setLayer(null)}
          project={project}
          stages={stages}
          blueprints={blueprints}
          presets={presets}
          definitions={definitions}
          unfinished={unfinished}
          nextCycleLabel={nextCycleLabel}
          itemList={itemList}
        />
      ) : null}
    </>
  );
}
