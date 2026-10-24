"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { HistoryButton } from "@/core/ui/composites/history-button";

/** The panel's code arrives on the first tap (ARCHITECTURE §19: the project page never grows). */
const ActivityPanel = dynamic(
  () => import("./activity-panel").then((module) => module.ActivityPanel),
  { ssr: false },
);

/**
 * The project page header's **History** button, next to ⋯ (the owner's preview feedback,
 * 2026-10-09; the one History pattern of the v1.8 consistency sweep): the 44 px clock that opens
 * the project's history panel. Each opening mounts the
 * panel afresh (its key), so it reads the newest page; closing keeps it mounted for its animation.
 */
export function ProjectActivityButton({ projectId }: { projectId: string }) {
  const [opened, setOpened] = useState(0);
  const [open, setOpen] = useState(false);
  return (
    <>
      <HistoryButton
        onOpen={() => {
          setOpened((count) => count + 1);
          setOpen(true);
        }}
      />
      {opened > 0 ? (
        <ActivityPanel key={opened} open={open} onOpenChange={setOpen} projectId={projectId} />
      ) : null}
    </>
  );
}
