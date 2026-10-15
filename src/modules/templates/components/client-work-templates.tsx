"use client";

import { useState } from "react";

import type { FieldDefinition } from "@/core/custom-fields";
import type { StagePresetOption } from "@/core/ui/stage-groups/editing";
import { TemplateSearch } from "@/core/ui/stage-groups/template-library";

import type { DeliverableTemplate } from "../domain/deliverable-templates";
import type { ProjectTemplate } from "../domain/project-templates";

import { DeliverableTemplateManager } from "./deliverable-template-manager";
import { ProjectTemplateManager } from "./project-template-manager";

/**
 * Settings → Templates, the client-work part (7.4; 6b Release 2, ROADMAP 6b.16 (f)): one
 * **search** over the project templates (name or a deliverable's title) and the deliverable
 * templates (name or a stage group), client-side over the loaded lists, then the two groups. The
 * search is a view control: it filters in place and adds no history (§14.2 d).
 */
export function ClientWorkTemplates({
  projectTemplates,
  deliverableTemplates,
  viewer,
  names,
  presets,
  definitions,
}: {
  projectTemplates: readonly ProjectTemplate[];
  deliverableTemplates: readonly DeliverableTemplate[];
  viewer: { id: string; role: string };
  names: Readonly<Record<string, string>>;
  presets: readonly (StagePresetOption & { stages: string[] })[];
  definitions: readonly FieldDefinition[];
}) {
  const [query, setQuery] = useState("");
  const any = projectTemplates.length > 0 || deliverableTemplates.length > 0;
  const offered = deliverableTemplates
    .filter((template) => !template.archived)
    .map((template) => ({
      id: template.id,
      name: template.name,
      stageGroups: template.stageGroups,
    }));
  return (
    <div className="flex flex-col gap-8" data-slot="client-work-templates">
      {any ? (
        <TemplateSearch
          value={query}
          onChange={setQuery}
          label="Search project and deliverable templates"
        />
      ) : null}
      <ProjectTemplateManager
        templates={projectTemplates}
        query={query}
        viewer={viewer}
        names={names}
        presets={presets}
        definitions={definitions}
        deliverableTemplates={offered}
      />
      <DeliverableTemplateManager
        templates={deliverableTemplates}
        presets={presets}
        viewer={viewer}
        names={names}
        query={query}
      />
    </div>
  );
}
