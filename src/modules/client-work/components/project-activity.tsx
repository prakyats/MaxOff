"use client";

import { HistoryIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

/** The panel's code arrives on the first tap (ARCHITECTURE §19: the project page never grows). */
const ActivityPanel = dynamic(
  () => import("./activity-panel").then((module) => module.ActivityPanel),
  { ssr: false },
);

/**
 * The project page header's **Activity** button, next to ⋯ (the owner's preview feedback,
 * 2026-10-09): a 44 px clock icon that opens the project's activity panel. Each opening mounts the
 * panel afresh (its key), so it reads the newest page; closing keeps it mounted for its animation.
 */
export function ProjectActivityButton({ projectId }: { projectId: string }) {
  const [opened, setOpened] = useState(0);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Activity"
        title="Activity"
        data-slot="project-activity-open"
        className="size-11"
        onClick={() => {
          setOpened((count) => count + 1);
          setOpen(true);
        }}
      >
        <HistoryIcon aria-hidden />
      </Button>
      {opened > 0 ? (
        <ActivityPanel key={opened} open={open} onOpenChange={setOpen} projectId={projectId} />
      ) : null}
    </>
  );
}
