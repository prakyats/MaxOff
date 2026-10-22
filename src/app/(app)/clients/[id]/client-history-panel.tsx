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
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { describeError } from "@/core/ui/toast";

import type { ClientHistoryData } from "../../../api/clients/history/read";

const HISTORY_URL = "/api/clients/history";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ClientHistoryData };

/**
 * A client's History sheet (3.4, PRODUCT §4.4): **reads the history only when it opens**
 * (`GET /api/clients/history`, a background call, ARCHITECTURE §4.4), never with the client's
 * layout. Mounted afresh for each opening (its caller keys it), so it reads the newest lines; the
 * skeleton traces them while it waits. A bottom sheet on a phone, a side panel from `md` up
 * (`ReviewSheet`), an overlay layer that back closes (§14.2 a). Loaded on the first tap
 * (`next/dynamic`, ARCHITECTURE §19): the client's pages never grow.
 */
export function ClientHistoryPanel({
  clientId,
  open,
  onOpenChange,
}: {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  // An answer to an earlier read is dropped.
  const request = useRef(0);

  const load = useCallback(() => {
    const id = ++request.current;
    void getInBackground<ClientHistoryData>(HISTORY_URL, { client: clientId }).then(
      (result: Result<ClientHistoryData>) => {
        if (id !== request.current) return;
        if (!result.ok) {
          const { title, description } = describeError(result.error);
          setState({ kind: "error", message: description ?? title });
          return;
        }
        setState({ kind: "ready", data: result.data });
      },
    );
  }, [clientId]);

  // Mounted for one opening: it reads once; Try again reads again.
  useEffect(() => {
    load();
  }, [load]);

  return (
    <ReviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title="History"
      description="Changes to this client"
    >
      <div data-slot="history-sheet">
        {state.kind === "loading" ? (
          <ClientHistorySkeleton />
        ) : state.kind === "error" ? (
          <div className="flex flex-col items-start gap-2" data-slot="client-activity-error">
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
          <ClientHistoryLines data={state.data} />
        )}
      </div>
    </ReviewSheet>
  );
}

function ClientHistoryLines({ data }: { data: ClientHistoryData }) {
  if (data.lines.length === 0) {
    return (
      <EmptyState
        icon={ICONS.history}
        title="Nothing recorded yet"
        description="Changes to this client, its brand and its contacts show here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2" data-slot="client-activity">
      <ol aria-label="History" className="divide-border divide-y">
        {data.lines.map((line) => (
          <li key={line.id} data-slot="activity-row" className="flex flex-col gap-0.5 py-3">
            <p className="text-sm">
              <span className="font-medium">{line.actor}</span> {line.text}
            </p>
            {line.note ? (
              <p className="text-muted-foreground text-sm break-words">&ldquo;{line.note}&rdquo;</p>
            ) : null}
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

/**
 * The history while it is read: rows that trace a line exactly (§14.1), the same `py-3` row and
 * `gap-0.5`, the sentence as one `text-sm` line and the date as one `text-xs` line, each bar
 * centred in a box of its line's own height (`h-[1lh]`, so it holds at 200% text). A close
 * reason's second line is not drawn: most lines have none.
 */
export function ClientHistorySkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the history"
      data-slot="loading-client-activity"
    >
      <ol aria-hidden className="divide-border divide-y">
        {[0, 1, 2, 3, 4].map((row) => (
          <li key={row} className="flex flex-col gap-0.5 py-3">
            <span className="flex h-[1lh] items-center text-sm">
              <Skeleton className="h-4 w-3/4" />
            </span>
            <span className="flex h-[1lh] items-center text-xs">
              <Skeleton className="h-3 w-28" />
            </span>
          </li>
        ))}
      </ol>
      <span className="sr-only">Loading the history</span>
    </div>
  );
}
