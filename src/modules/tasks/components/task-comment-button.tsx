"use client";

import { MessageSquarePlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

/** The sheet's code (a form with a select) loads on the first tap, not with the page (4B review S12). */
const TaskCommentDialog = dynamic(
  () => import("./task-comment-dialog").then((module) => module.TaskCommentDialog),
  { ssr: false },
);

/**
 * "Add a comment" (4.4; PRODUCT §4.6: timestamped updates). A sheet on a phone, so the keyboard
 * has the screen and the commit sits above it (§14.1). Comments stay open in every state,
 * locked or not (WORKFLOWS §3.1). A freelancer's coordinator may write as themselves or for the
 * freelancer ("Ravi for Asha", ADR-0013); the guard checks it again.
 */
export function TaskCommentButton({
  taskId,
  forOptions,
  defaultFor,
}: {
  taskId: string;
  /** The freelancers on this task the viewer coordinates now. */
  forOptions: { id: string; name: string }[];
  /** Who the comment is for by default: null = the viewer themselves. */
  defaultFor: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="h-11 self-start"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        data-slot="task-add-comment"
      >
        <MessageSquarePlusIcon aria-hidden />
        Add a comment
      </Button>
      {loaded ? (
        <TaskCommentDialog
          open={open}
          onOpenChange={setOpen}
          taskId={taskId}
          forOptions={forOptions}
          defaultFor={defaultFor}
        />
      ) : null}
    </>
  );
}
