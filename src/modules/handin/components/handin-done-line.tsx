"use client";

import { useEffect, useState } from "react";

import { getInBackground } from "@/core/http/background";

import type { HandinRead } from "../data/handin";
import { formatSize, markDoneBlock } from "../domain/summary";

/**
 * v5.0: the line the Mark done sheet shows above the note (the approved sample §2): what is being
 * handed in, "Hand-in v2 · 14 files · 5.4 GB · all in Drive", or the wait while files are still
 * uploading. Read when the sheet opens (a background call, ARCHITECTURE §4.4); Mark done itself
 * refuses while a file is uploading, whatever this line last read (`task_submit_done`).
 */
export function HandinDoneLine({ taskId }: { taskId: string }) {
  const [read, setRead] = useState<HandinRead | null>(null);
  useEffect(() => {
    let live = true;
    void getInBackground<HandinRead>("/api/handin/versions", { task: taskId }).then((result) => {
      if (live && result.ok) setRead(result.data);
    });
    return () => {
      live = false;
    };
  }, [taskId]);

  const open = read?.versions.find((version) => !version.handedIn) ?? null;
  if (!read || !open) return null;
  const inDrive = open.files.filter((file) => file.state === "done");
  const uploading = open.files.filter((file) => file.state === "uploading").length;
  const block = markDoneBlock(uploading);
  if (inDrive.length === 0 && !block) return null;
  const bytes = inDrive.reduce((sum, file) => sum + file.size, 0);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-slot="handin-done-line">
      {block ? (
        <p className="bg-info-soft rounded-md px-3 py-2 text-sm" role="status">
          <span className="text-info font-medium">{block}</span>
        </p>
      ) : null}
      <p className="border-border flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
        <span className="font-medium">
          Hand-in v{open.version} · {inDrive.length === 1 ? "1 file" : `${inDrive.length} files`}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {formatSize(bytes)}
          {block ? "" : " · all in Drive"}
        </span>
      </p>
    </div>
  );
}
