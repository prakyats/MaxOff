"use client";

import { HistoryIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Result } from "@/core/errors/result";
import { getInBackground } from "@/core/http/background";
import { cn } from "@/core/lib/utils";
import { formatIST } from "@/core/time";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReviewSheet } from "@/core/ui/composites/review-sheet";
import { Button } from "@/core/ui/primitives/button";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { describeError } from "@/core/ui/toast";

import {
  ACTIVITY_KINDS,
  type ActivityKind,
  type ActivityLine,
  type ActivityPage,
} from "../domain/activity";

const ACTIVITY_URL = "/api/client-work/activity";

/**
 * The skeleton's rows trace an entry exactly (§14.1): the same `py-3` row and `gap-0.5`, the
 * sentence as one line of the sheet's body text and the time as one `text-xs` line, each bar
 * centred in a box of that line's own height (`h-[1lh]`, so it holds at 200% text). An entry's
 * optional note is not drawn: most entries have none.
 */
const SKELETON_ROWS = 6;

export function ActivityRowsSkeleton({ rows = SKELETON_ROWS }: { rows?: number }) {
  return (
    <ol aria-hidden data-slot="activity-skeleton" className="divide-border divide-y">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className="flex flex-col gap-0.5 py-3">
          <span className="flex h-[1lh] items-center">
            <Skeleton className="h-4 w-4/5" />
          </span>
          <span className="flex h-[1lh] items-center text-xs">
            <Skeleton className="h-3 w-24" />
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A project's activity, or one item's (the owner's preview feedback, 2026-10-09; PRODUCT §4.5): a
 * bottom sheet on a phone, a side panel from `md` up (`ReviewSheet`), an overlay layer that back
 * closes (§14.2 a). Newest first, the latest 20 entries, then **Show older** (keyset pages from
 * `GET /api/client-work/activity`, never the whole history at once). The filter chips **All ·
 * Items · Stages · Project** are view state: no history entry, no address change (§14.2 d); one
 * item's history has none. Loaded after the page (`next/dynamic`, ARCHITECTURE §19). The Owner
 * and the client's Admin only (the page's own gate; the route checks `projects.manage`). Never an
 * amount.
 */
export function ActivityPanel({
  open,
  onOpenChange,
  projectId,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** One item's history only (the item sheet's "History"). */
  item?: { id: string; title: string } | null;
}) {
  const [kind, setKind] = useState<ActivityKind>("all");
  const [lines, setLines] = useState<readonly ActivityLine[]>([]);
  const [next, setNext] = useState<ActivityPage["next"]>(null);
  const [state, setState] = useState<"loading" | "ready" | "older" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  // Answers that arrive after the view changed are dropped.
  const request = useRef(0);
  const itemId = item?.id ?? null;

  // Sends a page's read; the state it waits in is set by whoever asked (an effect sets none).
  const load = useCallback(
    (cursor: ActivityPage["next"], from: ActivityKind) => {
      const id = ++request.current;
      void getInBackground<ActivityPage>(ACTIVITY_URL, {
        project: projectId,
        kind: from,
        ...(itemId ? { item: itemId } : {}),
        ...(cursor ? { beforeAt: cursor.at, beforeId: String(cursor.id) } : {}),
      }).then((result: Result<ActivityPage>) => {
        if (id !== request.current) return;
        if (!result.ok) {
          const { title, description } = describeError(result.error);
          setError(description ?? title);
          setState("error");
          return;
        }
        setError(null);
        setLines((current) => (cursor ? [...current, ...result.data.lines] : result.data.lines));
        setNext(result.data.next);
        setState("ready");
      });
    },
    [projectId, itemId],
  );

  // The panel is mounted afresh for each opening (its caller keys it), so it starts loading and
  // reads the newest page once; a chip or "Show older" reads the next one.
  useEffect(() => {
    if (open) load(null, "all");
  }, [open, load]);

  function show(from: ActivityKind) {
    setKind(from);
    setState("loading");
    load(null, from);
  }

  function older() {
    if (!next) return;
    setState("older");
    load(next, kind);
  }

  return (
    <ReviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={item ? `History of ${item.title}` : "Activity"}
      description={item ? "This item's changes, newest first." : "Newest first."}
    >
      <div className="flex flex-col gap-3" data-slot="activity-panel">
        {item ? null : (
          <div
            role="group"
            aria-label="Show"
            className="flex flex-wrap gap-2"
            data-slot="activity-chips"
          >
            {ACTIVITY_KINDS.map((chip) => (
              <Button
                key={chip.value}
                type="button"
                variant={kind === chip.value ? "strong" : "secondary"}
                size="sm"
                aria-pressed={kind === chip.value}
                data-slot="activity-chip"
                className="min-h-11 min-w-11"
                onClick={() => show(chip.value)}
              >
                {chip.label}
              </Button>
            ))}
          </div>
        )}
        {state === "loading" ? (
          <ActivityRowsSkeleton />
        ) : state === "error" && lines.length === 0 ? (
          <div className="flex flex-col items-start gap-2" data-slot="activity-error">
            <ErrorText>{error ?? "The activity could not be read."}</ErrorText>
            <Button variant="secondary" onClick={() => show(kind)}>
              Try again
            </Button>
          </div>
        ) : lines.length === 0 && next === null ? (
          <p
            className="text-muted-foreground flex items-center gap-2 py-3"
            data-slot="activity-empty"
          >
            <HistoryIcon className="size-4" aria-hidden />
            Nothing recorded yet.
          </p>
        ) : (
          <>
            <ol aria-label="Activity" data-slot="activity-lines" className="divide-border divide-y">
              {lines.map((line) => (
                <li key={line.id} data-slot="activity-line" className="flex flex-col gap-0.5 py-3">
                  <span className="break-words">
                    <span className="font-medium">{line.actor}</span> {line.text}
                  </span>
                  {line.note ? (
                    <span className="text-muted-foreground break-words">{line.note}</span>
                  ) : null}
                  <span className={cn("text-muted-foreground text-xs")}>
                    {formatIST(line.at, "d MMM yyyy, h:mm a")}
                  </span>
                </li>
              ))}
            </ol>
            {state === "error" ? <ErrorText>{error}</ErrorText> : null}
            {next ? (
              <Button
                variant="secondary"
                className="self-start"
                data-slot="activity-older"
                pending={state === "older"}
                pendingLabel="Loading…"
                onClick={older}
              >
                Show older
              </Button>
            ) : null}
          </>
        )}
      </div>
    </ReviewSheet>
  );
}
