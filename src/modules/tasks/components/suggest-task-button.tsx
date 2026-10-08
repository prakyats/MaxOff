"use client";

import { LightbulbIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

/** The form (a select, a textarea) loads when it first opens (§19), as "New task" does. */
const SuggestTaskDialog = dynamic(
  () => import("./suggest-task-dialog").then((module) => module.SuggestTaskDialog),
  { ssr: false },
);

/**
 * "Suggest a task" (4.6; PRODUCT §4.6, WORKFLOWS §3.4; `task_requests.create`: Staff and
 * Admins): a title, optional details and an optional client label (one the suggester can see,
 * Active or Paused, decision 22). The Owner or an Admin makes it a task or declines it with a
 * reason; it waits in Suggested tasks until then. A trigger that opens a form, so neutral solid
 * (a FAB on a phone through `PageHeader`); the commit is inside.
 */
export function SuggestTaskButton({
  clients,
  variant = "strong",
  details,
  className,
}: {
  /** The client labels the suggester may name. */
  clients: readonly { id: string; name: string }[];
  /**
   * `secondary` (a neutral outline) where the screen's one solid button is another (My Day, under
   * the strip's Start day: Kickoff 6 decision 3, "a neutral Suggest a task").
   */
  variant?: "strong" | "secondary";
  /**
   * What the details start with: a calendar day's "For Thu 8 Oct." (6.4b; Kickoff 6 decision 25
   * D: Crew get "Suggest a task" with the day prefilled; a suggestion has no date of its own).
   */
  details?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        onClick={() => setOpen(true)}
        data-slot="suggest-task"
        className={className}
      >
        <LightbulbIcon aria-hidden />
        Suggest a task
      </Button>
      {open ? (
        <SuggestTaskDialog
          clients={clients}
          initialDetails={details ?? ""}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
