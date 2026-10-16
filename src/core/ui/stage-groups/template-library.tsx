"use client";

import { EyeIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import {
  type Deliverable,
  type StageGroup,
  TEMPLATE_QUERY_MAX,
  templateMatches,
} from "@/core/lib/stage-groups";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Input } from "@/core/ui/primitives/input";

import { TemplatePreviewDialog } from "./template-preview-dialog";

/** A template as the library lists it: its name, a one-line summary and what it gives. */
export type LibraryTemplate = {
  id: string;
  name: string;
  line: string;
  deliverables: readonly Deliverable[];
  defaults: readonly StageGroup[];
};

/**
 * The template library (ROADMAP 6b.16 (f): search and a preview before using; no folders,
 * versions or usage counts): a search box over the names and the deliverables' titles
 * (`templateMatches`, client-side over the loaded list), one row per template, and a **Preview**
 * layer with "Use this template" as its one commit. Typing in the search is a view control: it
 * adds no history (§14.2 d); the library and its preview are layers, back closing the top one.
 */
export function TemplateLibrary({
  open,
  onOpenChange,
  templates,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly LibraryTemplate[];
  onUse: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const shown = templates.filter((template) =>
    templateMatches(query, [
      template.name,
      ...template.deliverables.map((deliverable) => deliverable.title),
    ]),
  );
  const previewing = templates.find((template) => template.id === previewId) ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-slot="template-library">
          <DialogHeader>
            <DialogTitle>Start from a template</DialogTitle>
            <DialogDescription>
              Preview one to see what it gives, then Use this template. Everything stays editable.
            </DialogDescription>
          </DialogHeader>
          <TemplateSearch value={query} onChange={setQuery} label="Search templates" />
          {shown.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-slot="template-library-empty">
              {query.trim() === ""
                ? "No templates yet: add one in Settings → Templates."
                : `No template matches “${query.trim()}”.`}
            </p>
          ) : (
            <ul
              data-slot="template-library-list"
              className="border-border divide-border divide-y rounded-lg border"
            >
              {shown.map((template) => (
                <li
                  key={template.id}
                  data-slot="template-library-row"
                  className="flex min-h-14 items-center gap-2 px-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{template.name}</span>
                    <span className="text-muted-foreground text-xs break-words">
                      {template.line}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    aria-label={`Preview ${template.name}`}
                    title={`See what a project started from ${template.name} gets`}
                    onClick={() => setPreviewId(template.id)}
                  >
                    <EyeIcon aria-hidden />
                    Preview
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <TemplatePreviewDialog
        open={open && previewing !== null}
        onOpenChange={(next) => {
          if (!next) setPreviewId(null);
        }}
        name={previewing?.name ?? ""}
        description="What a project started from it gets. Nothing is saved until Create."
        deliverables={previewing?.deliverables ?? []}
        defaults={previewing?.defaults ?? []}
        use={{
          label: "Use this template",
          onUse: () => {
            if (!previewing) return;
            setPreviewId(null);
            onUse(previewing.id);
          },
        }}
      />
    </>
  );
}

/** The library's search box: 16px, a 44px row, cleared by the browser's own ✕. */
export function TemplateSearch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="relative" data-slot="template-search">
      <SearchIcon
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder="Name or deliverable"
        value={value}
        maxLength={TEMPLATE_QUERY_MAX}
        className="pl-9"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
