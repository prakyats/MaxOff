"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { type BulkOutcome, bulkSummary } from "@/core/errors/bulk";
import type { Result } from "@/core/errors/result";
import { cn } from "@/core/lib/utils";
import { DelayedSends, UNDO_MS } from "@/core/ui/delayed-sends";
import { NETWORK_ERROR_MESSAGE } from "@/core/ui/action/network-error";
import { Button } from "@/core/ui/primitives/button";
import { describeError } from "@/core/ui/toast";

import { ConfirmDialog } from "./confirm-dialog";
import { APPROVAL_ROW_MIN_H, CARD_ROW_TRAILING, LIST_ROW_MIN_H } from "./row-metrics";
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
  /** A marker beside the status, e.g. a task's unread comments (Kickoff 4 decision 28). */
  marker?: ReactNode;
  /**
   * How long it has waited for the decision ("waiting 4 days") and its colour: muted, amber from a
   * day, red from three (the Owner's Today rows, `layout="rows"`; the words carry the meaning).
   */
  waiting?: ApprovalWaiting | undefined;
};

/** "waiting 4 days" and its colour (the dashboards' `waitingFor`, structurally). */
export type ApprovalWaiting = { label: string; tone: "muted" | "attention" | "danger" };

/** The waiting words' colours (§14.1: amber and red only where they mean something). */
const WAITING_TONE = {
  muted: "text-muted-foreground",
  attention: "text-attention",
  danger: "text-danger",
} as const;

/**
 * One group of the Approvals screen (PRODUCT "Approvals", WORKFLOWS §1 "Settled in 2.4"). Two
 * actions per row, never more: **Approve** (primary) and **Review** (everything that needs
 * thought opens the module's sheet). The header carries **Approve all N**. A group whose
 * decisions all need thought (Extra work, 3b.2: grant ½ or 1 day, or none) passes no `approve`
 * and offers Review alone, with no Approve all.
 *
 * - A single Approve fades the row in place and shows a 6-second Undo: the send is delayed
 *   (`DelayedSends`), and flushed at once when the page is hidden, left or unmounted. A send
 *   that fails puts the row back with its message.
 * - Approve all confirms with the count, sends **only the ids on screen**, has no Undo, and
 *   leaves every row that failed in place with its own message.
 *
 * Rows stay where they are until the server's refreshed list arrives, so nothing reshuffles
 * under the thumb; the waiting count is announced politely.
 *
 * **`layout="rows"`** (the Owner's Today, owner 2026-10-09): the same rows and the same Approve
 * (the 6-second Undo, the delayed send) as compact list items for a list the caller draws, so
 * every group's rows share one list with no headings: a small kind label, the name or title on
 * one line, one muted detail line ending in how long it has waited, and **one** button: Approve,
 * or Review when the group has no Approve (its decision needs the review). A tap on the row
 * opens the review. No Approve all.
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
  layout = "group",
  kind,
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
   * Absent: the group is review-only (no Approve, no Approve all).
   */
  approve?: (id: string) => Promise<Result<T>>;
  /** Absent (or undefined: the Owner's Today preview, 6.2): no Approve all. */
  approveAll?: ((ids: string[]) => Promise<Result<BulkOutcome>>) | undefined;
  /** Runs when a single approval has been recorded (e.g. to show kept dates). */
  onApproved?: (id: string, data: T) => void;
  onReview: (id: string) => void;
  /** `rows`: only the rows, as `<li>`s for the caller's list (the Owner's Today). */
  layout?: "group" | "rows";
  /** The rows' kind label in `layout="rows"`: "Leave", "Task", "Expense". */
  kind?: string;
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
      latest.current.approve?.(rowId).then(
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
        () => failed(`${NETWORK_ERROR_MESSAGE} It was not approved.`),
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
    if (!approveAll) return true;
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
  if (layout === "rows") {
    return (
      <>
        {rows.map((row) => (
          <CompactRow
            key={row.id}
            row={row}
            group={id}
            kind={kind ?? heading}
            held={held.has(row.id)}
            error={errors[row.id]}
            onReview={() => onReview(row.id)}
            onApprove={approve ? () => approveOne(row) : null}
          />
        ))}
      </>
    );
  }
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
        {count > 1 && approve && approveAll ? (
          <Button
            variant="strong"
            size="sm"
            commits
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
                  {row.marker}
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
                {approve ? (
                  <Button
                    variant="strong"
                    commits
                    onClick={() => approveOne(row)}
                    disabled={isHeld}
                  >
                    Approve
                  </Button>
                ) : null}
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

/**
 * One waiting item as a compact row (`layout="rows"`): the row itself opens the review; the one
 * button beside it approves (with Undo), or is Review when the decision needs it. At the default
 * text size the row is the button's 44px plus its padding (`APPROVAL_ROW_MIN_H`), so the loading
 * screen traces it (`ApprovalRowsSkeleton`).
 */
function CompactRow({
  row,
  group,
  kind,
  held,
  error,
  onReview,
  onApprove,
}: {
  row: ApprovalRow;
  group: string;
  kind: string;
  held: boolean;
  error: string | undefined;
  onReview: () => void;
  onApprove: (() => void) | null;
}) {
  const waiting = held ? { label: "Approved", tone: "muted" as const } : row.waiting;
  return (
    <li
      data-slot="approval-row"
      data-group={group}
      data-state={held ? "approved" : "waiting"}
      className={cn(
        "flex min-w-0 items-center gap-3 pr-4 transition-opacity duration-300",
        APPROVAL_ROW_MIN_H,
        held && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onReview}
        disabled={held}
        data-slot="approval-row-open"
        className="pressable-row focus-visible:ring-ring flex min-w-0 flex-1 flex-col justify-center gap-0.5 self-stretch py-2 pl-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span className="flex min-h-5 min-w-0 items-center gap-2">
          <span data-slot="approval-kind" className="text-muted-foreground shrink-0 text-xs">
            {kind}
          </span>
          <span className="min-w-0 truncate text-sm font-medium">{row.title}</span>
          {row.marker}
        </span>
        <span className="text-muted-foreground flex min-w-0 gap-1 text-xs">
          <span className="min-w-0 truncate">{row.subtitle}</span>
          {waiting ? (
            <span
              data-slot="approval-waiting"
              data-tone={waiting.tone}
              className={cn("shrink-0", WAITING_TONE[waiting.tone])}
            >
              · {waiting.label}
            </span>
          ) : null}
        </span>
        {error ? (
          <span data-slot="approval-error" role="status" className="text-destructive text-xs">
            {error}
          </span>
        ) : null}
      </button>
      {onApprove ? (
        <Button variant="strong" commits onClick={onApprove} disabled={held}>
          Approve
        </Button>
      ) : (
        <Button variant="secondary" onClick={onReview} disabled={held}>
          Review
        </Button>
      )}
    </li>
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
