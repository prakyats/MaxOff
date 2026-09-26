"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { type BulkOutcome, bulkSummary } from "@/core/errors/bulk";
import { ERROR_MESSAGES } from "@/core/errors/codes";
import type { Result } from "@/core/errors/result";
import { cn } from "@/core/lib/utils";
import { DelayedSends, UNDO_MS } from "@/core/ui/delayed-sends";
import { Button } from "@/core/ui/primitives/button";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { describeError } from "@/core/ui/toast";

import { ConfirmDialog } from "./confirm-dialog";
import { CARD_ROW_TRAILING, LIST_ROW_MIN_H } from "./row-metrics";
import { StatusDot } from "./status-badge";

/** One row waiting for a decision: what it is, whose, and where it stands. */
export type ApprovalRow = {
  id: string;
  title: string;
  subtitle: string;
  /** The dot's status key and the word beside it (a dot plus a word, never colour alone). */
  status: string;
  statusLabel: string;
  /** The Undo toast's text, e.g. "Approved Asha's present". */
  approvedLabel: string;
};

/**
 * One group of the Approvals screen (PRODUCT "Approvals", WORKFLOWS §1 "Settled in 2.4"). Two
 * actions per row, never more: **Approve** (primary) and **Review** (everything that needs
 * thought opens the module's sheet). The header carries **Approve all N**.
 *
 * - A single Approve fades the row in place and shows a 6-second Undo: the send is delayed
 *   (`DelayedSends`), and flushed at once when the page is hidden, left or unmounted. A send
 *   that fails puts the row back with its message.
 * - Approve all confirms with the count, sends **only the ids on screen**, has no Undo, and
 *   leaves every row that failed in place with its own message.
 *
 * Rows stay where they are until the server's refreshed list arrives, so nothing reshuffles
 * under the thumb; the waiting count is announced politely.
 */
export function ApprovalGroup<T>({
  id,
  heading,
  noun,
  rows,
  approve,
  approveAll,
  onApproved,
  onReview,
}: {
  /** Stable id for tests and the heading's `aria-labelledby`. */
  id: string;
  heading: string;
  /** "day" / "days", "request" / "requests": for "Approve all 7 days?". */
  noun: { one: string; other: string };
  rows: readonly ApprovalRow[];
  /**
   * Sends one approval. It may run while the page is being hidden or left, so it should outlive
   * the page (`postKeepalive`); a rejection (the network) is that row's error like any other.
   */
  approve: (id: string) => Promise<Result<T>>;
  approveAll: (ids: string[]) => Promise<Result<BulkOutcome>>;
  /** Runs when a single approval has been recorded (e.g. to show kept dates). */
  onApproved?: (id: string, data: T) => void;
  onReview: (id: string) => void;
}) {
  // Faded rows: waiting to be sent, or sent and waiting for the refreshed list.
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [confirmAll, setConfirmAll] = useState(false);
  const router = useRouter();

  // The latest callbacks, for sends that fire after a re-render or while unmounting.
  const latest = useRef({ approve, onApproved, router });
  useEffect(() => {
    latest.current = { approve, onApproved, router };
  });

  // The waiting sends live for as long as the group is on screen. Never lose one: the app going
  // to the background, being closed, or this screen being left sends it at once.
  const sends = useRef<DelayedSends | null>(null);
  useEffect(() => {
    const current = new DelayedSends((rowId) => {
      // Sent: Undo can no longer take it back, so its toast goes (a hidden page pauses the
      // toast's own timer, and it would otherwise offer an Undo that does nothing).
      toast.dismiss(toastId(rowId));
      const failed = (message: string) => {
        setErrors((errors) => ({ ...errors, [rowId]: message }));
        setHeld((held) => without(held, rowId));
      };
      latest.current.approve(rowId).then(
        (result) => {
          if (!result.ok) {
            const { title, description } = describeError(result.error);
            failed(description ?? title);
            return;
          }
          latest.current.onApproved?.(rowId, result.data);
          latest.current.router.refresh();
        },
        // The network, or a page that went away mid-request: never a silent approval.
        () => failed(`${ERROR_MESSAGES.INTERNAL} It was not approved; try again.`),
      );
    }, UNDO_MS);
    sends.current = current;
    const onHidden = () => {
      if (document.visibilityState === "hidden") current.flush();
    };
    const onPageHide = () => current.flush();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      current.flush();
      sends.current = null;
    };
  }, []);

  const waiting = rows.filter((row) => !held.has(row.id));

  function approveOne(row: ApprovalRow) {
    setErrors((current) => omit(current, row.id));
    setHeld((current) => new Set(current).add(row.id));
    sends.current?.schedule(row.id);
    toast(row.approvedLabel, {
      id: toastId(row.id),
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (sends.current?.undo(row.id)) {
            setHeld((current) => without(current, row.id));
          } else {
            toast("Already sent", { description: "Undo came too late: it was approved." });
          }
        },
      },
    });
  }

  async function approveEveryone(): Promise<boolean> {
    const ids = waiting.map((row) => row.id);
    const result = await approveAll(ids);
    if (!result.ok) {
      const { title, description } = describeError(result.error);
      toast.error(title, description ? { description } : undefined);
      return true;
    }
    const outcome = result.data;
    setHeld((current) => new Set([...current, ...outcome.done]));
    setErrors((current) => {
      const next = { ...current };
      for (const id of outcome.done) delete next[id];
      for (const failure of outcome.failed) next[failure.id] = failure.message;
      return next;
    });
    const summary = bulkSummary(outcome, "approved");
    const extra = outcome.note ? { description: outcome.note } : undefined;
    if (outcome.failed.length > 0) toast.warning(summary, extra);
    else toast.success(summary, extra);
    return true;
  }

  if (rows.length === 0) return null;
  const headingId = `approvals-${id}-heading`;
  const count = waiting.length;

  return (
    <section aria-labelledby={headingId} data-slot="approval-group" data-group={id}>
      {/* Wraps under large system text: "Approve all" drops under the heading (§14.2 i). */}
      <div className="mb-2 flex min-h-11 flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-muted-foreground text-sm font-medium">
          {heading}{" "}
          <span className="tabular-nums" aria-live="polite" data-slot="approval-count">
            {count}
          </span>
          <span className="sr-only"> waiting</span>
        </h2>
        {count > 1 ? (
          <Button
            variant="strong"
            size="sm"
            className={CARD_ROW_TRAILING}
            onClick={() => setConfirmAll(true)}
          >
            Approve all {count}
          </Button>
        ) : null}
      </div>
      <ul className="border-border divide-border bg-card divide-y rounded-lg border">
        {rows.map((row) => {
          const isHeld = held.has(row.id);
          const error = errors[row.id];
          return (
            <li
              key={row.id}
              data-slot="approval-row"
              data-state={isHeld ? "approved" : "waiting"}
              className={cn(
                "flex flex-col gap-2 px-4 py-3 transition-opacity duration-300 md:flex-row md:items-center md:gap-4",
                LIST_ROW_MIN_H,
                isHeld && "opacity-50",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* A name too long to share the line puts its status underneath instead of being
                    squeezed to nothing (large system text, §14.2 i). */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="max-w-full min-w-0 truncate font-medium">{row.title}</span>
                  <StatusDot
                    status={isHeld ? "approved" : row.status}
                    label={isHeld ? "Approved" : row.statusLabel}
                    className="shrink-0"
                  />
                </div>
                <span className="text-muted-foreground truncate text-sm">{row.subtitle}</span>
                {error ? (
                  <span
                    data-slot="approval-error"
                    role="status"
                    className="text-destructive text-sm"
                  >
                    {error}
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2 *:flex-1 md:*:flex-none">
                <Button variant="secondary" onClick={() => onReview(row.id)} disabled={isHeld}>
                  Review
                </Button>
                <Button variant="strong" onClick={() => approveOne(row)} disabled={isHeld}>
                  Approve
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={`Approve all ${count} ${count === 1 ? noun.one : noun.other}?`}
        description="Each is approved as it was sent. There is no undo for approving all at once."
        confirmLabel={`Approve ${count}`}
        onConfirm={approveEveryone}
      />
    </section>
  );
}

const toastId = (rowId: string) => `approve-${rowId}`;

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

function omit(record: Readonly<Record<string, string>>, id: string): Record<string, string> {
  const next = { ...record };
  delete next[id];
  return next;
}

/**
 * `ApprovalGroup` while the screen loads (ARCHITECTURE §14.1): the same header row, the same
 * two-line rows and the same two buttons, stacked under the text on a phone and beside it from
 * `md` up, so nothing moves when the data arrives.
 */
export function ApprovalGroupSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-hidden data-slot="loading-approval-group">
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-11 w-28 rounded-md md:h-7" />
      </div>
      <ul className="border-border divide-border bg-card divide-y rounded-lg border">
        {Array.from({ length: rows }, (_, i) => (
          <li
            key={i}
            className={cn(
              "flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4",
              LIST_ROW_MIN_H,
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3.5 w-1/3" />
            </div>
            <div className="flex shrink-0 gap-2 *:flex-1 md:*:flex-none">
              <Skeleton className="h-11 rounded-md md:h-8 md:w-20" />
              <Skeleton className="h-11 rounded-md md:h-8 md:w-20" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
