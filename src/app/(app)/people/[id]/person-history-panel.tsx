"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Result } from "@/core/errors/result";
import { getInBackground } from "@/core/http/background";
import { formatDateTime } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { ErrorText } from "@/core/ui/composites/error-text";
import { ReviewSheet } from "@/core/ui/composites/review-sheet";
import { ICONS } from "@/core/ui/icons";
import { Button } from "@/core/ui/primitives/button";
import { describeError } from "@/core/ui/toast";

import { ClientHistorySkeleton } from "../../clients/[id]/client-history-panel";

import type { PersonHistoryData } from "../../../api/people/history/read";

const HISTORY_URL = "/api/people/history";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: PersonHistoryData };

/**
 * A person's History sheet (PP-person-1), the client page's pattern: **reads the history only
 * when it opens** (`GET /api/people/history`, a background call), never with the person's layout.
 * Mounted afresh for each opening, so it reads the newest lines; the client history's skeleton
 * traces them while it waits. A bottom sheet on a phone, a side panel from `md` up, an overlay
 * layer that back closes (§14.2 a). Loaded on the first tap (`next/dynamic`).
 */
export function PersonHistoryPanel({
  memberId,
  open,
  onOpenChange,
}: {
  memberId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  // An answer to an earlier read is dropped.
  const request = useRef(0);

  const load = useCallback(() => {
    const id = ++request.current;
    void getInBackground<PersonHistoryData>(HISTORY_URL, { member: memberId }).then(
      (result: Result<PersonHistoryData>) => {
        if (id !== request.current) return;
        if (!result.ok) {
          const { title, description } = describeError(result.error);
          setState({ kind: "error", message: description ?? title });
          return;
        }
        setState({ kind: "ready", data: result.data });
      },
    );
  }, [memberId]);

  // Mounted for one opening: it reads once; Try again reads again.
  useEffect(() => {
    load();
  }, [load]);

  return (
    <ReviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title="History"
      description="Changes to this person"
    >
      <div data-slot="history-sheet">
        {state.kind === "loading" ? (
          <ClientHistorySkeleton />
        ) : state.kind === "error" ? (
          <div className="flex flex-col items-start gap-2" data-slot="person-activity-error">
            <ErrorText>{state.message}</ErrorText>
            <Button
              variant="secondary"
              onClick={() => {
                setState({ kind: "loading" });
                load();
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <PersonHistoryLines data={state.data} />
        )}
      </div>
    </ReviewSheet>
  );
}

function PersonHistoryLines({ data }: { data: PersonHistoryData }) {
  if (data.lines.length === 0) {
    return (
      <EmptyState
        icon={ICONS.history}
        title="Nothing recorded yet"
        description="Changes to their name, role, job title and access show here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2" data-slot="person-activity">
      <ol aria-label="History" className="divide-border divide-y">
        {data.lines.map((line) => (
          <li key={line.id} data-slot="activity-row" className="flex flex-col gap-0.5 py-3">
            <p className="text-sm">
              <span className="font-medium">{line.actor}</span> {line.text}
            </p>
            <p className="text-muted-foreground text-xs">
              <time dateTime={line.at}>{formatDateTime(line.at, "d MMM yyyy")}</time>
            </p>
          </li>
        ))}
      </ol>
      {data.limitedTo !== null ? (
        <p className="text-muted-foreground text-xs">The latest {data.limitedTo} changes.</p>
      ) : null}
    </div>
  );
}
