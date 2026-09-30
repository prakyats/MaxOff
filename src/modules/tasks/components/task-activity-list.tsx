"use client";

import { useState } from "react";

import { Button } from "@/core/ui/primitives/button";

/** A history line as the page drew it on the server (times in IST, the pair's names). */
export type ActivityLine = {
  id: number;
  actor: string;
  text: string;
  note?: string;
  at: string;
  /** "2 Oct 2026, 5:10 PM". */
  atLabel: string;
};

/** The newest lines the Activity view opens with (Kickoff 4 decision 29). */
export const ACTIVITY_FIRST = 5;

/**
 * A task's history, newest first (Kickoff 4 decision 29): the newest five, then **Show all**,
 * which opens the rest in place. It changes what this view shows, so it adds no history entry and
 * one back still leaves the task (ARCHITECTURE §14.2 d). Consecutive ticks by the same person are
 * already one line (`collapseTicks`).
 */
export function TaskActivityList({ lines }: { lines: ActivityLine[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, ACTIVITY_FIRST);
  const hidden = lines.length - shown.length;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ol
        aria-label="History"
        data-slot="task-history"
        className="border-border divide-border bg-card divide-y rounded-lg border"
      >
        {shown.map((line) => (
          <li
            key={line.id}
            data-slot="task-history-row"
            className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5"
          >
            <p className="text-sm break-words">
              <span className="font-medium">{line.actor}</span> {line.text}
            </p>
            {line.note ? (
              <p className="text-muted-foreground text-sm break-words">&ldquo;{line.note}&rdquo;</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              <time dateTime={line.at}>{line.atLabel}</time>
            </p>
          </li>
        ))}
      </ol>
      {hidden > 0 ? (
        <Button
          type="button"
          variant="secondary"
          className="h-11 self-start"
          data-slot="task-history-show-all"
          onClick={() => setAll(true)}
        >
          Show all {lines.length}
        </Button>
      ) : null}
    </div>
  );
}
