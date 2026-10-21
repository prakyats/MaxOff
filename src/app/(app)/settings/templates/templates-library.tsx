"use client";

import { type ComponentProps, useState, useSyncExternalStore } from "react";

import type { FieldDefinition } from "@/core/custom-fields";
import { templateMatches } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { TemplateSearch } from "@/core/ui/stage-groups/template-library";
import type { StagePreset } from "@/modules/settings";
import { StagePresetManager } from "@/modules/settings/components/stage-preset-manager";
import type { TaskTemplate } from "@/modules/tasks";
import { TemplateManager } from "@/modules/tasks/components/template-manager";
import type { DeliverableTemplate, ProjectTemplate } from "@/modules/templates";
import { DeliverableTemplateManager } from "@/modules/templates/components/deliverable-template-manager";
import { ProjectTemplateManager } from "@/modules/templates/components/project-template-manager";

import { TEMPLATE_SECTIONS, TEMPLATE_TABS_CLASS, type TemplateSectionKey } from "./sections";

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
function readHash(): string {
  return window.location.hash.slice(1);
}

/**
 * The one Templates page (6b.6 owner note, 2026-10-16), in build order: Stage presets →
 * Deliverable templates → Project templates, a divider, then Task templates (staff tasks). One
 * search filters all four in place; each section has its own "Add …" and the same row actions
 * (Preview where there is something to look at, Edit, Delete = the archive, D6).
 *
 * **Phone:** the four sections are a segmented control (a view control: it adds no history,
 * §14.2 d), showing one section at a time; while a search is typed each segment carries its
 * number of matches, so a hit in another section is never hidden. `#presets` (the old Stage
 * presets page's redirect), `#deliverables`, `#projects` and `#tasks` pick the segment on arrival.
 * **Laptop:** the sections stack, each under its heading.
 */
export function TemplatesLibrary({
  presets,
  deliverableTemplates,
  projectTemplates,
  taskTemplates,
  taskContext,
  viewer,
  names,
  projectFields,
  showPresets,
}: {
  presets: readonly StagePreset[];
  deliverableTemplates: readonly DeliverableTemplate[];
  projectTemplates: readonly ProjectTemplate[];
  taskTemplates: readonly TaskTemplate[];
  taskContext: Omit<ComponentProps<typeof TemplateManager>, "templates" | "query">;
  viewer: { id: string; role: string };
  names: Readonly<Record<string, string>>;
  projectFields: readonly FieldDefinition[];
  /** Stage presets are `lists.manage` (the Owner and Admins today); hidden for anyone else. */
  showPresets: boolean;
}) {
  const [query, setQuery] = useState("");
  const sections = TEMPLATE_SECTIONS.filter((section) => showPresets || section.key !== "presets");
  // An arrival with a section's hash (the old Stage presets path redirects to #presets) opens
  // that segment on a phone until a segment is tapped; a laptop scrolls to it by itself.
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  const [chosen, setTab] = useState<TemplateSectionKey | null>(null);
  const tab: TemplateSectionKey =
    chosen ??
    sections.find((section) => section.key === hash)?.key ??
    sections[0]?.key ??
    "deliverables";

  const offeredPresets = presets
    .filter((preset) => !preset.archived)
    .map((preset) => ({ id: preset.id, name: preset.name, stages: preset.stages }));
  const offeredDeliverables = deliverableTemplates
    .filter((template) => !template.archived)
    .map((template) => ({
      id: template.id,
      name: template.name,
      stageGroups: template.stageGroups,
    }));

  const matches: Record<TemplateSectionKey, number> = {
    presets: offeredPresets.filter((preset) =>
      templateMatches(query, [preset.name, ...preset.stages]),
    ).length,
    deliverables: deliverableTemplates.filter(
      (template) =>
        !template.archived &&
        templateMatches(query, [
          template.name,
          ...template.stageGroups.flatMap((group) => group.label ?? []),
        ]),
    ).length,
    projects: projectTemplates.filter(
      (template) =>
        !template.archived &&
        templateMatches(query, [
          template.name,
          ...template.deliverables.map((deliverable) => deliverable.title),
        ]),
    ).length,
    tasks: taskTemplates.filter(
      (template) =>
        !template.archived && templateMatches(query, [template.name, ...template.stages]),
    ).length,
  };
  const searching = query.trim().length > 0;
  const shown = (key: TemplateSectionKey) => cn(tab !== key && "hidden md:flex");

  return (
    <div className="flex flex-col gap-6" data-slot="templates-library">
      <TemplateSearch
        value={query}
        onChange={setQuery}
        label="Search stage presets and templates"
      />

      <div
        role="tablist"
        aria-label="Template kinds"
        data-slot="template-tabs"
        className={TEMPLATE_TABS_CLASS}
      >
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            role="tab"
            id={`tab-${section.key}`}
            aria-selected={tab === section.key}
            aria-controls={section.key}
            onClick={() => setTab(section.key)}
            className={cn(
              "pressable text-muted-foreground focus-visible:ring-ring rounded-control flex min-h-11 min-w-0 flex-col items-center justify-center px-1 text-xs font-medium outline-none focus-visible:ring-2",
              tab === section.key && "bg-background text-foreground shadow-raised",
            )}
          >
            <span className="max-w-full truncate">{section.tab}</span>
            {searching ? (
              <span className="tabular-nums" data-slot="template-tab-count">
                {matches[section.key]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {showPresets ? (
        <div
          id="presets"
          role="tabpanel"
          aria-labelledby="tab-presets"
          className={cn("scroll-mt-24 flex-col", shown("presets"))}
        >
          <StagePresetManager presets={presets} viewer={viewer} names={names} query={query} />
        </div>
      ) : null}
      <div
        id="deliverables"
        role="tabpanel"
        aria-labelledby="tab-deliverables"
        className={cn("scroll-mt-24 flex-col", shown("deliverables"))}
      >
        <DeliverableTemplateManager
          templates={deliverableTemplates}
          presets={offeredPresets}
          viewer={viewer}
          names={names}
          query={query}
        />
      </div>
      <div
        id="projects"
        role="tabpanel"
        aria-labelledby="tab-projects"
        className={cn("scroll-mt-24 flex-col", shown("projects"))}
      >
        <ProjectTemplateManager
          templates={projectTemplates}
          query={query}
          viewer={viewer}
          names={names}
          presets={offeredPresets}
          definitions={projectFields}
          deliverableTemplates={offeredDeliverables}
        />
      </div>
      {/* The divider: client work above, staff tasks below (6b.6 owner note). */}
      <hr className="border-border hidden md:block" data-slot="templates-divider" />
      <div
        id="tasks"
        role="tabpanel"
        aria-labelledby="tab-tasks"
        className={cn("scroll-mt-24 flex-col", shown("tasks"))}
      >
        <TemplateManager templates={taskTemplates} query={query} {...taskContext} />
      </div>
    </div>
  );
}
