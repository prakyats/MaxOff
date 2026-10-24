"use client";

import { useEffect, useRef, useState } from "react";

import type { Result } from "@/core/errors";
import { unusedDeleteCopy, type UnusedDeleteKind, type UnusedUsage } from "@/core/lib/owner-delete";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";

/**
 * The Owner-only Delete's confirm for something that may have been used (v1.8 V5a 6c, owner
 * 2026-10-22: "any reference counts as used"): a task type, job title, expense category, custom
 * field, draft client or contact. It first asks the database whether anything has ever pointed at it
 * (`loadUsage`, `unused_usage`); unused, its red `danger` commit is "Delete ‹name›" and the way out
 * "Keep it"; in use, it shows the plain reason ("In use — archive it instead.") and only "Close".
 * Built on `ConfirmDialog` like 6b's `TemplateDeleteDialog`: a bottom sheet on a phone, and back
 * closes it (ARCHITECTURE §14.2).
 */
export function UnusedDeleteDialog({
  kind,
  name,
  loadUsage,
  onOpenChange,
  onConfirm,
}: {
  kind: UnusedDeleteKind;
  name: string;
  loadUsage: () => Promise<Result<UnusedUsage>>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void | boolean>;
}) {
  const [usage, setUsage] = useState<UnusedUsage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Read once, when the confirm opens (the caller's loader is a fresh function every render).
  const loader = useRef(loadUsage);
  useEffect(() => {
    let live = true;
    void loader.current().then((result) => {
      if (!live) return;
      if (result.ok) setUsage(result.data);
      else setProblem(result.error.message);
    });
    return () => {
      live = false;
    };
  }, []);

  const copy = unusedDeleteCopy(kind, name, usage);
  return (
    <ConfirmDialog
      open
      destructive
      onOpenChange={onOpenChange}
      title={copy.title}
      description={problem === null ? copy.description : undefined}
      confirmLabel={copy.confirmLabel}
      pendingLabel="Deleting…"
      cancelLabel={copy.cancelLabel}
      confirmDisabled={!copy.canDelete}
      confirmHidden={usage !== null && !copy.canDelete}
      onConfirm={onConfirm}
    >
      {problem !== null ? (
        <ErrorText slot="form-alert">{`Couldn't check whether it's used: ${problem}`}</ErrorText>
      ) : null}
    </ConfirmDialog>
  );
}
