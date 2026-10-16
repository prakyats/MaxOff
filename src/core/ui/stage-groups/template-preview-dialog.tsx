"use client";

import type { Deliverable, StageGroup } from "@/core/lib/stage-groups";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";

import { DeliverablesPreview } from "./deliverables-preview";

/**
 * A template's preview before using it (ROADMAP 6b.16 (f), the template library): exactly what
 * it gives, its deliverables with their stage groups and the counts (`DeliverablesPreview`). A
 * layer of its own (§14.2 a): back closes it and nothing else; on a phone a bottom sheet. `use`
 * is the one commit (the library's "Use this template"); without it, the preview only shows.
 */
export function TemplatePreviewDialog({
  open,
  onOpenChange,
  name,
  description,
  deliverables,
  defaults,
  use,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  description: string;
  deliverables: readonly Deliverable[];
  defaults: readonly StageGroup[];
  use?: { label: string; onUse: () => void } | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="template-preview-dialog">
        <DialogHeader>
          <DialogTitle>{`Preview ${name}`}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DeliverablesPreview deliverables={deliverables} defaults={defaults} />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {use ? "Back to templates" : "Close"}
          </Button>
          {use ? (
            // pending: none — it fills the form; the form's own Create commits.
            <Button
              type="button"
              variant="primary"
              data-slot="template-use"
              onClick={() => use.onUse()}
            >
              {use.label}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
