"use client";

import { useState } from "react";

import { ApprovalGroup } from "@/core/ui/composites/approval-group";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { postKeepalive } from "@/core/ui/keepalive";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { approveTasks } from "../actions/approvals";
import { reviewTask } from "../actions/tasks";

import { LinkedText } from "./linked-text";
import { UnreadMarker } from "./unread-marker";

/** The route behind the delayed send (`app/api/approvals/approve`): it outlives the page. */
const APPROVE_URL = "/api/approvals/approve";

/** A task waiting for the viewer's decision, as the group shows it (worked out on the server). */
export type TaskApprovalItem = {
  id: string;
  title: string;
  /** "Done by Ravi for Asha, 2 Oct, 5:10 PM · late". */
  subtitle: string;
  /** The task state for the dot, and its word ("Waiting for your check"). */
  status: string;
  statusLabel: string;
  /** Whose work it is, for the reason's copy: "Asha will see this reason." */
  primaryName: string;
  deadline: string;
  handedIn: string;
  note: string | null;
  lateReason: string | null;
  /** The approval's Undo toast: "Checked Reel edit: on to the Owner". */
  approvedLabel: string;
  /** The viewer's unread comments on it (Kickoff 4 decision 28). */
  unread: number;
};

/**
 * The Staff tasks group of Approvals (4.5; PRODUCT §4.7, WORKFLOWS §3.1, Kickoff 4 decision 5):
 * the tasks at the step the viewer decides, the oldest hand-in first. Approve is instant with a
 * 6-second Undo (a delayed send); "Approve all N" confirms with the count and approves only; a
 * change request lives behind Review, one task with a reason the people on it will read. Review
 * shows the hand-in (its links tappable), the late reason and a way to the task's page.
 */
export function TaskApprovalGroup({
  tasks,
  heading,
  preview = false,
}: {
  tasks: TaskApprovalItem[];
  heading: string;
  /** The Owner's Today shows a few rows with their two actions and no Approve all (6.2). */
  preview?: boolean;
}) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const review = tasks.find((task) => task.id === reviewId) ?? null;
  const rejecting = tasks.find((task) => task.id === rejectId) ?? null;

  return (
    <>
      <ApprovalGroup
        id="tasks"
        heading={heading}
        noun={{ one: "task", other: "tasks" }}
        rows={tasks.map((task) => ({
          id: task.id,
          title: task.title,
          subtitle: task.subtitle,
          status: task.status,
          statusLabel: task.statusLabel,
          approvedLabel: task.approvedLabel,
          marker: <UnreadMarker count={task.unread} />,
        }))}
        approve={(taskId) => postKeepalive<null>(APPROVE_URL, { kind: "task", id: taskId })}
        approveAll={preview ? undefined : (taskIds) => approveTasks({ taskIds })}
        onReview={setReviewId}
      />
      <ReviewSheet
        open={review !== null}
        onOpenChange={(open) => (open ? null : setReviewId(null))}
        title={review?.title ?? ""}
        description={review?.statusLabel}
        actions={
          review ? (
            <>
              <Button variant="ghost" asChild>
                <OverlayLink href={`/tasks/${review.id}`}>Open the task</OverlayLink>
              </Button>
              <Button variant="destructive" onClick={() => setRejectId(review.id)}>
                Request changes…
              </Button>
            </>
          ) : null
        }
      >
        {review ? (
          <div className="flex flex-col gap-4" data-slot="task-review">
            <ReviewFacts
              facts={[
                { label: "Handed in", value: review.handedIn },
                { label: "Deadline", value: review.deadline },
                ...(review.lateReason ? [{ label: "Late", value: review.lateReason }] : []),
              ]}
            />
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-xs">Their note</p>
              {review.note ? (
                <LinkedText text={review.note} slot="task-review-note" />
              ) : (
                <p className="text-muted-foreground">No note.</p>
              )}
            </div>
          </div>
        ) : null}
      </ReviewSheet>
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(open) => (open ? null : setRejectId(null))}
        title={rejecting ? `Request changes to ${rejecting.title}?` : "Request changes"}
        description={
          rejecting
            ? `It goes back to them to fix. ${rejecting.primaryName} will see this reason.`
            : undefined
        }
        label="What needs to change"
        placeholder="They will see this reason."
        submitLabel="Request changes"
        onSubmit={async (reason) => {
          if (!rejecting) return;
          const done = toastResult(
            await reviewTask({ taskId: rejecting.id, decision: "rejected", reason }),
            { success: "Changes requested" },
          );
          if (done) setReviewId(null);
          return done;
        }}
      />
    </>
  );
}
