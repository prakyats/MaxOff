"use client";

import { ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { getInBackground, postInBackground } from "@/core/http/background";
import { systemClock } from "@/core/time";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { toastResult } from "@/core/ui/toast";

import { eraseUploaderNetwork } from "../actions/links";
import type { UploaderSheet, UploaderSheetFile } from "../domain/card";
import {
  checkBeforeOpening,
  driveFileUrl,
  fileChip,
  fileLine,
  fileNotes,
  fileTag,
  uploaderLine,
} from "../domain/card-view";

/**
 * One uploader's files (v4.5, WORKFLOWS §5B.3; sample §5 "One uploader's files"): each file's full
 * name, size and state, "Check before opening" on programs and web pages (Q13), Removed in Drive
 * (grey, Q7), ⋯ Open in Drive on a received file. Read when it opens (`/api/uploads/sheet`); once
 * on screen it asks Drive about its received files (`/api/uploads/drive-check`), never on the task
 * page's first render. The IP and browser for the Owner only (Q12).
 */
export function UploaderSheetView({
  uploaderId,
  network,
  onOpenChange,
}: {
  uploaderId: string | null;
  network: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [sheet, setSheet] = useState<UploaderSheet | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [erase, setErase] = useState(false);

  useEffect(() => {
    if (!uploaderId) return;
    let gone = false;
    void (async () => {
      const read = await getInBackground<UploaderSheet>("/api/uploads/sheet", {
        uploader: uploaderId,
      });
      if (gone) return;
      if (!read.ok) {
        setFailed(true);
        return;
      }
      setSheet(read.data);
      const received = read.data.files
        .filter((file) => file.state === "done" || file.state === "missing_in_drive")
        .filter((file) => file.driveFileId && file.inCurrentAccount)
        .map((file) => file.id);
      if (received.length === 0) return;
      const checked = await postInBackground<UploaderSheet>("/api/uploads/drive-check", {
        uploaderId,
        fileIds: received,
      });
      if (!gone && checked.ok) setSheet(checked.data);
    })();
    return () => {
      gone = true;
      setSheet(null);
      setFailed(false);
    };
  }, [uploaderId, attempt]);

  const now = systemClock();
  const shown = sheet && sheet.uploader.id === uploaderId ? sheet : null;
  const u = shown?.uploader;

  return (
    <Sheet open={uploaderId !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-slot="uploader-sheet"
        className="max-h-[85dvh] gap-0 overflow-y-auto md:mx-auto md:max-w-2xl"
      >
        <SheetHeader className="gap-1.5">
          <SheetTitle>
            {u
              ? `${u.name} · ${shown.files.length} ${shown.files.length === 1 ? "file" : "files"}`
              : "Files"}
          </SheetTitle>
          {u ? (
            <SheetDescription className="flex flex-col items-start gap-1.5">
              {!u.onTask ? (
                <StatusBadge status="uploader" label="Not on this task · new name" tone="neutral" />
              ) : null}
              <span data-slot="uploader-line">{uploaderLine(shown, now)}</span>
              {network && (u.ip || u.userAgent) ? (
                <span data-slot="uploader-network" className="text-xs break-all">
                  {u.ip ? `IP ${u.ip}` : null}
                  {u.ip && u.userAgent ? " · " : null}
                  {u.userAgent}
                </span>
              ) : null}
              {network && u.networkErasedAt ? (
                <span className="text-xs">IP and device details erased.</span>
              ) : null}
            </SheetDescription>
          ) : (
            <SheetDescription className="sr-only">One uploader&apos;s files</SheetDescription>
          )}
        </SheetHeader>

        {failed ? (
          <div className="flex flex-col items-start gap-3 px-4 pb-6">
            <ErrorText slot="uploader-error">These files couldn&apos;t be loaded.</ErrorText>
            <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          </div>
        ) : !shown ? (
          <SheetSkeleton />
        ) : (
          <ul className="pb-4" data-slot="uploader-files">
            {shown.files.map((file) => (
              <FileRow key={file.id} file={file} now={now} />
            ))}
          </ul>
        )}

        {network && u && !u.networkErasedAt ? (
          <div className="border-border border-t px-4 py-3">
            <Button variant="ghost" onClick={() => setErase(true)} data-slot="uploader-erase">
              Erase IP and device details now
            </Button>
          </div>
        ) : null}
        <ConfirmDialog
          open={erase}
          onOpenChange={setErase}
          title="Erase this uploader's IP and device details?"
          description="Their name and file list stay with the task. This can't be undone."
          confirmLabel="Erase details"
          destructive
          onConfirm={async () => {
            if (!u) return;
            const result = await eraseUploaderNetwork({ uploaderId: u.id });
            if (toastResult(result, { success: "IP and device details erased" })) {
              setAttempt((n) => n + 1);
            }
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function FileRow({ file, now }: { file: UploaderSheetFile; now: Date }) {
  const chip = fileChip(file);
  const notes = fileNotes(file);
  const risky = checkBeforeOpening(file.name);
  const openable = file.state === "done" && file.driveFileId !== null;
  return (
    <li
      className="border-border flex min-h-15 min-w-0 items-center gap-3 border-t px-4 py-2.5 first:border-t-0"
      data-slot="uploader-file"
      data-state={file.state}
    >
      <span
        aria-hidden
        className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold"
      >
        {fileTag(file.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The full name, as text only (plan D2, D3): long names wrap, never cut. */}
        <span className="font-medium break-all" data-slot="uploader-file-name">
          {file.name}
        </span>
        {file.relativePath ? (
          <span className="text-faint text-xs break-all">{file.relativePath}</span>
        ) : null}
        <span className="text-muted-foreground text-xs">{fileLine(file, now)}</span>
        {notes.map((note) => (
          <span key={note} className="text-muted-foreground text-xs">
            {note}
          </span>
        ))}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge status={`file-${file.state}`} label={chip.label} tone={chip.tone} />
        {risky ? (
          <StatusBadge status="file-check" label="Check before opening" tone="neutral" />
        ) : null}
      </span>
      {openable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${file.name}`}
              className="size-11 shrink-0 md:size-8"
            >
              <MoreHorizontalIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" title={file.name}>
            <DropdownMenuItem asChild>
              <a
                href={driveFileUrl(file.driveFileId ?? "")}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Drive
                <ExternalLinkIcon aria-hidden />
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span aria-hidden className="w-11 shrink-0 md:w-8" />
      )}
    </li>
  );
}

function SheetSkeleton() {
  return (
    <ul aria-hidden className="pb-4" data-slot="uploader-files-loading">
      {[0, 1, 2, 3].map((row) => (
        <li
          key={row}
          className="border-border flex min-h-15 items-center gap-3 border-t px-4 py-2.5 first:border-t-0"
        >
          <Skeleton className="size-9 rounded-lg" />
          <span className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-28" />
          </span>
          <Skeleton className="h-5 w-14 rounded-full" />
          <span className="w-11 md:w-8" />
        </li>
      ))}
    </ul>
  );
}
