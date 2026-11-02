"use client";

import { LightbulbIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { Button } from "@/core/ui/primitives/button";

import { DAY_ROW_BUTTON } from "./day-row-button";

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
  label = "Suggest a task",
  row,
  className,
}: {
  /** The client labels the suggester may name. */
  clients: readonly { id: string; name: string }[];
  /**
   * `secondary` (a neutral outline) where the screen's one solid button is another (My Day, under
   * the strip's Start day: Kickoff 6 decision 3, "a neutral Suggest a task"); `quiet`, a muted
   * text link at the foot of My Day (PP-crew-2), still a 44 px target on a phone.
   */
  variant?: "strong" | "secondary" | "quiet";
  /**
   * What the details start with: a calendar day's "For Thu 8 Oct." (6.4b; Kickoff 6 decision 25
   * D: Crew get "Suggest a task" with the day prefilled; a suggestion has no date of its own).
   */
  details?: string;
  /** "Suggest a task on Fri 30 Oct" in a calendar day (v1.9 W5); "Suggest a task" elsewhere. */
  label?: string;
  /** The pinned row at the foot of a calendar day (v1.9 W5): the whole row is the button. */
  row?: boolean | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant === "quiet" || row ? "ghost" : variant}
        onClick={() => setOpen(true)}
        data-slot="suggest-task"
        data-quiet={variant === "quiet" ? "" : undefined}
        data-row={row ? "" : undefined}
        className={cn(
          variant === "quiet" &&
            "text-muted-foreground hover:text-foreground -ml-2 px-2 underline-offset-4 hover:bg-transparent hover:underline",
          row && DAY_ROW_BUTTON,
          className,
        )}
      >
        <LightbulbIcon aria-hidden />
        {/* A calendar day's longer label ellipsises at a very large text size, never wider than
            its row (as "New task on ‹day›"). */}
        <span className="min-w-0 truncate">{label}</span>
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
