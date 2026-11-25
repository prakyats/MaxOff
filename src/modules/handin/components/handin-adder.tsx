"use client";

import { UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { postInBackground } from "@/core/http/background";
import { cn } from "@/core/lib/utils";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import type {
  ItemState,
  OpenedSession,
  SessionRefusal,
  UploadEngine,
  UploadItem,
} from "@/core/upload/types";

import type { StartAnswer } from "../data/handin";
import { cleanRelativePath, sameFileKey, typeLabel } from "../domain/files";
import { formatSize, progressLines, statusOf } from "../domain/summary";
import { createUploadEngine } from "./upload-engine";

/**
 * v5.0: adding files to the open version (the approved sample §1, §3, §4). The phone's picker, or
 * on a laptop files and whole folders (dropped or chosen, folders kept). Each file goes straight
 * to Google through the shared engine (`core/upload`, v4.5's); MaxOff's server only opens each
 * session and records what Google says. Files already in this version (same folder, name and
 * size) are skipped as "Already added". While anything is on its way: the overall progress, the
 * keep-open band, and the browser's own warning on leaving the page.
 */

/**
 * Until v4.5's engine lands with its final contract (#89 7162679961), `already_sent` and
 * `resumed` are not yet in `core/upload/types.ts`: these local types carry them meanwhile.
 */
type Refused = SessionRefusal["refused"] | "already_sent";
type RowState = Exclude<ItemState, { state: "refused" }> | { state: "refused"; refused: Refused };
type Opened = OpenedSession & { resumed?: boolean };
type Row = { key: string; name: string; relativePath: string; size: number; state: RowState };

const REFUSED_WORDS: Record<string, string> = {
  limit: "Waiting for a free slot. Try again in a moment.",
  no_space: "The studio's Drive is nearly full. The Owner has been told.",
  stopped: "Files can't be added to this task now.",
  already_sent: "Already added",
  empty: "This file is empty.",
  bad_name: "This file's name can't be used.",
  too_big: "This file is too big.",
  type_not_allowed: "This kind of file isn't accepted.",
};

function folderOf(file: File): string {
  // A laptop's folder pick or drop gives "Top/Day 1/clip.mp4": the folders are kept.
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
  const parts = path.split("/").slice(0, -1).join("/");
  const cleaned = cleanRelativePath(parts);
  return cleaned.ok ? cleaned.path : "";
}

function rowStatus(state: RowState): {
  label: string;
  tone: "info" | "success" | "danger" | "neutral";
} {
  switch (state.state) {
    case "waiting":
      return statusOf("waiting");
    case "uploading":
      return {
        label: `Uploading ${Math.floor((state.sent / Math.max(state.total, 1)) * 100)}%`,
        tone: "info",
      };
    case "paused":
      return statusOf("paused");
    case "done":
      return statusOf("done");
    case "failed":
      return statusOf("failed");
    case "refused":
      return state.refused === "already_sent"
        ? statusOf("already_added")
        : { label: "Not added", tone: "neutral" };
  }
}

export function HandinAdder({
  taskId,
  onBehalfOf,
  alreadyInDrive,
}: {
  taskId: string;
  onBehalfOf: string | null;
  /** `sameFileKey` of every file already in Drive for the open version. */
  alreadyInDrive: readonly string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ReadonlyMap<string, Row>>(new Map());
  const [dragging, setDragging] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const inDrive = useMemo(() => new Set(alreadyInDrive), [alreadyInDrive]);
  const known = useRef(inDrive);
  useEffect(() => {
    known.current = inDrive;
  }, [inDrive]);
  const meta = useRef(new Map<string, { name: string; relativePath: string; size: number }>());
  const refreshSoon = useRef<number | null>(null);

  const engineRef = useRef<UploadEngine | null>(null);
  // Made on the first add (an event, never during render), and kept for the page's life.
  function engine(): UploadEngine {
    engineRef.current ??= createUploadEngine({
      openSession: async (item: UploadItem): Promise<OpenedSession | SessionRefusal> => {
        const refuse = (refused: Refused) => ({ refused }) as unknown as SessionRefusal;
        const result = await postInBackground<StartAnswer>("/api/handin/start", {
          taskId,
          name: item.file.name,
          relativePath: item.relativePath,
          size: item.file.size,
          mimeType: item.file.type || null,
          onBehalfOf,
        });
        if (!result.ok) return refuse("stopped");
        const answer = result.data;
        if (answer.kind === "open") {
          const opened: Opened = {
            sessionUrl: answer.sessionUrl,
            fileId: answer.fileId,
            resumed: answer.resumed,
          };
          return opened;
        }
        return refuse(answer.kind === "already_added" ? "already_sent" : answer.refused);
      },
      report: async (event) => {
        if (event.kind === "progress") {
          await postInBackground("/api/handin/progress", {
            fileId: event.fileId,
            bytes: event.sent,
          });
        } else if (event.kind === "done") {
          const localMd5 = (event as { localMd5?: string | null }).localMd5 ?? null;
          await postInBackground("/api/handin/finish", {
            fileId: event.fileId,
            driveFileId: event.driveFileId,
            localMd5,
          });
        } else {
          await postInBackground("/api/handin/fail", { fileId: event.fileId, reason: "gave_up" });
        }
      },
      onChange: (key, state) => {
        const facts = meta.current.get(key);
        if (!facts) return;
        setRows((current) =>
          new Map(current).set(key, { key, ...facts, state: state as RowState }),
        );
        if (state.state === "done" || state.state === "failed") {
          if (refreshSoon.current !== null) window.clearTimeout(refreshSoon.current);
          refreshSoon.current = window.setTimeout(() => router.refresh(), 1500);
        }
      },
    });
    return engineRef.current;
  }
  useEffect(() => () => engineRef.current?.dispose(), []);

  const list = [...rows.values()];
  const busy = list.some((row) => row.state.state === "uploading" || row.state.state === "waiting");
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function add(files: readonly File[]) {
    const items: UploadItem[] = [];
    const skipped = new Map<string, Row>();
    for (const file of files) {
      const relativePath = folderOf(file);
      const key = sameFileKey({ relativePath, name: file.name, size: file.size });
      const facts = { name: file.name, relativePath, size: file.size };
      meta.current.set(key, facts);
      if (known.current.has(key)) {
        skipped.set(key, {
          key,
          ...facts,
          state: { state: "refused", refused: "already_sent" as never },
        });
        continue;
      }
      if (rows.has(key) && rows.get(key)?.state.state !== "failed") continue;
      items.push({ key, file, relativePath });
    }
    if (skipped.size > 0) setRows((current) => new Map([...current, ...skipped]));
    if (items.length > 0) engine().add(items);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    add(Array.from(event.dataTransfer.files));
  }

  // Rows already in Drive leave this list once the card re-reads (they show there instead).
  const visible = list.filter((row) => row.state.state !== "done" || !inDrive.has(row.key));
  const progress = {
    done: list.filter((row) => row.state.state === "done").length,
    total: list.filter((row) => row.state.state !== "refused").length,
    bytesDone: list.reduce(
      (sum, row) =>
        sum +
        (row.state.state === "done"
          ? row.size
          : row.state.state === "uploading" || row.state.state === "paused"
            ? row.state.sent
            : 0),
      0,
    ),
    bytesTotal: list
      .filter((row) => row.state.state !== "refused")
      .reduce((sum, row) => sum + row.size, 0),
  };
  const paused = list.some((row) => row.state.state === "paused");
  const lines = progressLines(progress, 0, paused);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-slot="handin-adder">
      {busy || progress.total > 0 ? (
        <div className="flex min-w-0 flex-col gap-2" data-slot="handin-progress">
          <span className="text-lg font-semibold tabular-nums">{lines.headline}</span>
          <div className="bg-neutral-soft flex h-2 overflow-hidden rounded-full" aria-hidden>
            <i
              className="bg-success block h-full"
              style={{
                width: `${progress.bytesTotal ? (progress.bytesDone / progress.bytesTotal) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">{lines.detail}</span>
        </div>
      ) : null}
      {busy ? (
        <p
          className="bg-attention-soft rounded-md px-3 py-2 text-xs"
          role="status"
          data-slot="handin-keep-open"
        >
          <span className="text-attention font-semibold">Keep MaxOff open</span> until every file
          says In Drive. Closing it stops the upload.
        </p>
      ) : null}
      {visible.length > 0 ? (
        <ul className="flex min-w-0 flex-col" aria-label="Files you're adding">
          {visible.map((row) => {
            const status = rowStatus(row.state);
            const reason =
              row.state.state === "refused"
                ? row.state.refused === "already_sent"
                  ? null
                  : (REFUSED_WORDS[row.state.refused] ?? null)
                : row.state.state === "failed"
                  ? row.state.reason
                  : null;
            return (
              <li
                key={row.key}
                className="border-border flex min-h-[60px] min-w-0 items-center gap-3 border-t py-2 first:border-t-0"
                data-slot="handin-local-file"
                data-state={row.state.state}
              >
                <span
                  aria-hidden
                  className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md text-xs font-semibold"
                >
                  {typeLabel(row.name)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{row.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {[row.relativePath, formatSize(row.size), reason].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {row.state.state === "failed" && row.state.canRetry ? (
                  <Button variant="destructive" size="sm" onClick={() => engine().retry(row.key)}>
                    Retry
                  </Button>
                ) : (
                  <StatusBadge status={row.state.state} tone={status.tone} label={status.label} />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-slot="handin-drop"
        className={cn(
          "md:border-control-border flex min-w-0 flex-col items-start gap-2 md:items-center md:rounded-lg md:border md:border-dashed md:p-5 md:text-center",
          dragging && "md:bg-muted",
        )}
      >
        <span className="hidden md:flex md:flex-col md:items-center md:gap-1">
          <UploadIcon aria-hidden className="text-muted-foreground size-5" />
          <span className="text-sm">Drop files or folders here</span>
        </span>
        <div className="flex flex-wrap gap-2 md:justify-center">
          <Button onClick={() => filesInput.current?.click()} data-slot="handin-add">
            <span className="md:hidden">
              {progress.total > 0 ? "Add more" : "Add photos and videos"}
            </span>
            <span className="hidden md:inline">Choose files</span>
          </Button>
          <Button
            className="hidden md:inline-flex"
            onClick={() => folderInput.current?.click()}
            data-slot="handin-add-folder"
          >
            Choose a folder
          </Button>
        </div>
        <span className="text-muted-foreground hidden text-xs md:inline">
          Any file, any size. Folders are kept as they are.
        </span>
        <input
          ref={filesInput}
          type="file"
          multiple
          hidden
          data-slot="handin-file-input"
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          {...{ webkitdirectory: "" }}
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
