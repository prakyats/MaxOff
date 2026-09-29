"use client";

import { ImageUpIcon, Trash2Icon } from "lucide-react";
import { type ChangeEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import type { Result } from "@/core/errors";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { describeError, toastResult } from "@/core/ui/toast";

import { uploadImageWithPreview } from "../client/upload";
import { acceptFor, checkFile, type FilePurpose, formatBytes, MAX_BYTES } from "../limits";

/**
 * Choosing and saving one image, a logo or a photo (task 3.3, PRODUCT §4.4 / §4.16): a
 * trigger opens a bottom sheet (its own layer, so its one red Save never sits next to the
 * screen's), the picker checks type and size before a byte leaves the phone, the chosen image
 * is shown, Save uploads the original and a browser-made JPEG preview and then hands the file
 * ids to the record's own action. Remove is a destructive action with a named confirmation.
 * The sheet closes on back like every dialog (ARCHITECTURE §14.2 a).
 */
export function ImageUploadSheet({
  purpose,
  title,
  triggerLabel,
  saveLabel,
  removeLabel,
  hasCurrent,
  onSave,
  onRemove,
  round = false,
}: {
  purpose: Exclude<FilePurpose, "preview">;
  /** The sheet's heading, e.g. "Company logo". */
  title: string;
  /** The trigger, e.g. "Change logo". */
  triggerLabel: string;
  /** The commit, e.g. "Save logo". */
  saveLabel: string;
  /** The destructive action and its confirmation label, e.g. "Remove logo". */
  removeLabel: string;
  hasCurrent: boolean;
  /** The record's action: attaches the uploaded original (and its preview, when one was made). */
  onSave: (input: { fileId: string; previewFileId?: string }) => Promise<Result<unknown>>;
  onRemove?: () => Promise<Result<unknown>>;
  /** Round preview for an avatar; a logo keeps its shape. */
  round?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // A local URL of the chosen file, revoked when it changes or the sheet unmounts.
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  function close() {
    if (pending) return;
    setOpen(false);
    setFile(null);
    setProblem(null);
    setProgress(null);
  }

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setProblem(null);
    if (!chosen) {
      setFile(null);
      return;
    }
    const reason = checkFile(purpose, { mime: chosen.type, size: chosen.size });
    if (reason) {
      setFile(null);
      setProblem(reason);
      return;
    }
    setFile(chosen);
  }

  // One upload per tap; a slow or lost connection is said under the buttons, and the chosen
  // file stays chosen (ARCHITECTURE §14.1).
  const action = useAction(async (chosen: File) => {
    setProgress(0);
    try {
      await upload(chosen);
    } finally {
      setProgress(null);
    }
  });
  const { pending } = action;

  async function upload(chosen: File) {
    const uploaded = await uploadImageWithPreview({
      purpose,
      file: chosen,
      onProgress: setProgress,
    });
    if (!uploaded.ok) {
      setProblem(uploaded.message);
      return;
    }
    const saved = await onSave({
      fileId: uploaded.fileId,
      ...(uploaded.previewFileId ? { previewFileId: uploaded.previewFileId } : {}),
    });
    if (!saved.ok) {
      const summary = describeError(saved.error);
      setProblem(summary.description ?? summary.title);
      return;
    }
    toastResult(saved, { success: `${title} saved` });
    setOpen(false);
    setFile(null);
  }

  function save() {
    if (file) action.run(file);
  }

  const busyLabel =
    progress !== null && progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Saving…";

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <ImageUpIcon aria-hidden />
        {triggerLabel}
      </Button>
      {open ? (
        <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
          <DialogContent data-slot="image-upload-sheet">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {purpose === "avatar"
                  ? `A PNG, JPEG or WebP up to ${formatBytes(MAX_BYTES.avatar)}. The original is kept; a small preview is shown.`
                  : `A PNG, JPEG, WebP or SVG up to ${formatBytes(MAX_BYTES.logo)}. The original is kept; a small preview is shown in lists.`}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <label
                htmlFor={inputId}
                className="border-border hover:border-ring flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm"
              >
                {objectUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL of the chosen file
                  <img
                    src={objectUrl}
                    alt="The chosen image"
                    data-slot="image-upload-preview"
                    className={`max-h-40 max-w-full object-contain ${round ? "size-32 rounded-full object-cover" : ""}`}
                  />
                ) : (
                  <>
                    <ImageUpIcon className="text-muted-foreground size-6" aria-hidden />
                    <span>Choose an image</span>
                  </>
                )}
                {file ? (
                  <span className="text-muted-foreground text-xs">
                    {file.name} · {formatBytes(file.size)}
                  </span>
                ) : null}
              </label>
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept={acceptFor(purpose)}
                onChange={pick}
                disabled={pending}
                className="sr-only"
                data-slot="image-upload-input"
              />
              {problem ? <ErrorText slot="form-alert">{problem}</ErrorText> : null}
            </div>

            <ActionStatus action={action} />
            <DialogFooter>
              {hasCurrent && onRemove ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmRemove(true)}
                  disabled={pending}
                  className="md:mr-auto"
                >
                  <Trash2Icon aria-hidden />
                  {removeLabel}
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={save}
                disabled={!file}
                pending={pending}
                pendingLabel={busyLabel}
              >
                {saveLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {confirmRemove && onRemove ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirmRemove(false);
          }}
          title={`${removeLabel}?`}
          description="The file is kept for 30 days, then only its record."
          confirmLabel={removeLabel}
          onConfirm={async () => {
            const result = await onRemove();
            toastResult(result, { success: `${title} removed` });
            setConfirmRemove(false);
            if (result.ok) close();
          }}
        />
      ) : null}
    </>
  );
}
