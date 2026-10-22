"use client";

import { useEffect, useRef, useState } from "react";

import type { Result } from "@/core/errors";
import {
  deleteNeedsUsage,
  templateDeleteCopy,
  type TemplateDeleteKind,
  type TemplateUsage,
} from "@/core/lib/owner-delete";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";

const NONE: TemplateUsage = { used: 0, open: 0 };

/**
 * The Owner-only Delete's confirm for a template or a stage preset (v1.8 V5a 6b, owner 2026-10-22).
 * It says exactly what happens (`templateDeleteCopy`): for a project or task template it first reads
 * what uses it (`loadUsage`, the database's `template_usage`), and the red commit waits until it
 * knows. The commit is the `danger` "Delete ‹name›"; the way out is "Keep it". It is a dialog (a
 * bottom sheet on a phone), so back closes it (ARCHITECTURE §14.2).
 */
export function TemplateDeleteDialog({
  kind,
  name,
  loadUsage,
  onOpenChange,
  onConfirm,
}: {
  kind: TemplateDeleteKind;
  name: string;
  loadUsage?: () => Promise<Result<TemplateUsage>>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void | boolean>;
}) {
  const needsUsage = deleteNeedsUsage(kind) && loadUsage !== undefined;
  const [usage, setUsage] = useState<TemplateUsage | null>(needsUsage ? null : NONE);
  const [problem, setProblem] = useState<string | null>(null);

  // Read once, when the confirm opens (the caller's loader is a fresh function every render).
  const loader = useRef(loadUsage);
  useEffect(() => {
    const load = loader.current;
    if (!needsUsage || !load) return;
    let live = true;
    void load().then((result) => {
      if (!live) return;
      if (result.ok) setUsage(result.data);
      else setProblem(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [needsUsage]);

  const copy = templateDeleteCopy(kind, name, usage ?? NONE);
  return (
    <ConfirmDialog
      open
      destructive
      onOpenChange={onOpenChange}
      title={copy.title}
      description={
        usage === null
          ? problem === null
            ? "Checking where it's used…"
            : undefined
          : copy.description
      }
      confirmLabel={copy.confirmLabel}
      pendingLabel="Deleting…"
      cancelLabel="Keep it"
      confirmDisabled={usage === null}
      onConfirm={onConfirm}
    >
      {problem !== null ? (
        <ErrorText slot="form-alert">{`Couldn't check where it's used: ${problem}`}</ErrorText>
      ) : null}
    </ConfirmDialog>
  );
}
