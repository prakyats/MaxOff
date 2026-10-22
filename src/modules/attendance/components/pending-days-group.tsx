"use client";

import { useRef, useState } from "react";

import type { Result } from "@/core/errors";
import { getInBackground } from "@/core/http/background";
import { cn } from "@/core/lib/utils";
import { ApprovalGroup, type ApprovalWaiting } from "@/core/ui/composites/approval-group";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { attendanceStatus, StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { postKeepalive } from "@/core/ui/keepalive";
import { displayName } from "@/core/lib/display-name";

import { approveDays } from "../actions/review";
import { historyDate } from "../domain/history";
import { reviewWeek, type ReviewContext } from "../domain/review-context";
import {
  approvedLabel,
  pendingDetail,
  pendingLabel,
  pendingOutcome,
  pendingStart,
  pendingSubtitle,
  type PendingDay,
} from "../domain/review";

import { CorrectDayDialog, type CorrectTarget } from "./correct-day-dialog";

/** The route behind the delayed send (`app/api/approvals/approve`): it outlives the page. */
const APPROVE_URL = "/api/approvals/approve";
/** The Review panel's context (B4): the person's week and comp leave, read when it opens. */
const CONTEXT_URL = "/api/attendance/review-context";

/**
 * The Attendance group of Approvals (task 2.4): every day waiting for the Owner, oldest first.
 * Approve is instant with Undo; Review opens the day in a sheet with the context to decide on
 * (B4, UX review 2026-10-21: the person's week, their comp leave, their note) and both decisions:
 * Approve, the sheet's one solid action, which takes the row's own path (the same send with its
 * Undo), and Correct (status + a reason the member will read). The dialog is held here, beside
 * the sheet, so the sheet stays open under it and back closes them one at a time (ARCHITECTURE
 * §14.2 a).
 */
export function PendingDaysGroup({
  days,
  today,
  preview = false,
  waiting,
}: {
  days: PendingDay[];
  today: string;
  /**
   * The Owner's Today: compact rows for its one list (kind, name, detail, how long it waited,
   * Approve with Undo; a tap opens Review), no heading and no Approve all (owner 2026-10-09).
   */
  preview?: boolean;
  /** Each day's waiting words on the Owner's Today, worked out on the server. */
  waiting?: Readonly<Record<string, ApprovalWaiting>>;
}) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [correct, setCorrect] = useState<CorrectTarget | null>(null);
  const [contexts, setContexts] = useState<Readonly<Record<string, Result<ReviewContext>>>>({});
  const approveHandle = useRef<((id: string) => void) | null>(null);
  const review = days.find((day) => day.id === reviewId) ?? null;
  const context = review ? contexts[review.id] : undefined;

  function openReview(dayId: string) {
    setReviewId(dayId);
    if (contexts[dayId]?.ok) return;
    void getInBackground<ReviewContext>(CONTEXT_URL, { day: dayId }).then((result) =>
      setContexts((current) => ({ ...current, [dayId]: result })),
    );
  }

  return (
    <>
      <ApprovalGroup
        id="attendance"
        heading="Attendance"
        noun={{ one: "day", other: "days" }}
        rows={days.map((day) => ({
          id: day.id,
          title: day.memberName,
          avatar: {
            id: day.memberId,
            name: day.memberName,
            avatarFileId: day.memberAvatarFileId ?? null,
          },
          // A compact row's first meta line: what was chosen and when, never cut short.
          // Approvals' row carries the panel's context too (B4, V3): the person's note.
          subtitle: preview
            ? pendingDetail(day, today)
            : day.note
              ? `${pendingSubtitle(day, today)} · “${day.note}”`
              : pendingSubtitle(day, today),
          status: "pending_review",
          statusLabel: pendingLabel(day),
          approvedLabel: approvedLabel(day),
          waiting: waiting?.[day.id],
        }))}
        approve={(dayId) => postKeepalive<null>(APPROVE_URL, { kind: "day", id: dayId })}
        approveAll={preview ? undefined : (dayIds) => approveDays({ dayIds })}
        onReview={openReview}
        layout={preview ? "rows" : "group"}
        kind="Attendance"
        approveHandle={approveHandle}
      />
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? null : setReviewId(null))}
        title={review ? `${review.memberName}` : ""}
        description={review ? historyDate(review.workDate) : undefined}
        actions={
          review ? (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  setCorrect({
                    dayId: review.id,
                    memberName: review.memberName,
                    workDate: review.workDate,
                    current: pendingOutcome(review),
                    leaveType: null,
                    // Many members on one screen: the balance is not read here, so comp leave
                    // stays choosable and the database's refusal shows in the dialog (3c review).
                    compDays: null,
                  })
                }
              >
                Correct…
              </Button>
              <Button
                variant="approve"
                commits
                data-slot="review-approve"
                onClick={() => {
                  const id = review.id;
                  setReviewId(null);
                  approveHandle.current?.(id);
                }}
              >
                Approve
              </Button>
            </>
          ) : null
        }
      >
        {review ? (
          <ReviewFacts
            facts={[
              {
                label: review.submittedChoice
                  ? `${displayName(review.memberName)} chose`
                  : "Proposed",
                value: pendingLabel(review),
              },
              ...(review.note ? [{ label: "Their note", value: review.note }] : []),
              pendingStart(review),
              ...(review.onApprovedLeave
                ? [{ label: "Leave", value: "Approved leave covers this day; it stays as it is" }]
                : []),
              {
                label: "Comp leave",
                value: context?.ok ? (
                  context.data.compLeave
                ) : context ? (
                  "Not loaded"
                ) : (
                  <Skeleton className="ml-auto h-4 w-28" />
                ),
              },
            ]}
          />
        ) : null}
        {review ? (
          <ReviewWeek
            context={context}
            // The skeleton has the week's own number of lines (Monday up to today), so nothing moves.
            lines={reviewWeek([], review.workDate, today).length}
          />
        ) : null}
      </ReviewSheet>
      <CorrectDayDialog
        target={correct}
        onOpenChange={(open) => (open ? null : setCorrect(null))}
        onCorrected={() => setReviewId(null)}
      />
    </>
  );
}

/**
 * The person's week around the day (B4): Monday to today, one line a day with its status in the
 * shared colours (`attendanceStatus`, B13), the reviewed day marked. Its own number of skeleton
 * lines while it loads, a quiet line if it cannot be read.
 */
function ReviewWeek({
  context,
  lines,
}: {
  context: Result<ReviewContext> | undefined;
  lines: number;
}) {
  return (
    <section aria-label="This week" data-slot="review-week" className="mt-4 flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">This week</h3>
      {context === undefined ? (
        <ul aria-hidden className="flex flex-col gap-1">
          {Array.from({ length: lines }, (_, index) => (
            <li key={index} className="flex min-h-7 items-center justify-between gap-4">
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-24" />
            </li>
          ))}
        </ul>
      ) : context.ok ? (
        <ul className="flex flex-col gap-1">
          {context.data.week.map((day) => (
            <li
              key={day.date}
              data-slot="review-week-day"
              data-current={day.current ? "" : undefined}
              className={cn(
                "flex min-h-7 items-center justify-between gap-4 rounded-md px-2",
                day.current && "bg-muted font-medium",
              )}
            >
              <span>{day.current ? `${day.label} (this day)` : day.label}</span>
              <StatusDot
                status={attendanceStatus(day.dot)}
                label={day.status}
                className="text-sm"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">The week could not be loaded.</p>
      )}
    </section>
  );
}
