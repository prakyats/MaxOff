"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/core/lib/utils";
import { useAction } from "@/core/ui/action/use-action";

import {
  type ApprovalWaiting,
  useApprovalGroupsShown,
  WaitingWords,
} from "@/core/ui/composites/approval-group";
import { PersonAvatar } from "@/core/ui/composites/person-avatar";
import { APPROVAL_ROW_MIN_H, LIST_ROW_MIN_H } from "@/core/ui/composites/row-metrics";
import { Button } from "@/core/ui/primitives/button";
import { describeError, toastResult } from "@/core/ui/toast";

import { decideEarlyLeave } from "../actions/hours";
import { historyDate } from "../domain/history";
import {
  earlyLeavePreviewDetail,
  earlyLeaveSubtitle,
  earlyLeaveTitle,
  type EarlyLeaveRequest,
} from "../domain/hours";

import { CorrectDayDialog, type CorrectTarget } from "./correct-day-dialog";

/**
 * The Owner's early-leave requests in Approvals (v1.9 W4; the working-hours sample §3; WORKFLOWS §1:
 * only the Owner decides). Two groups: **Leaving early** (waiting: **Stay**, outlined, and
 * **Approve**: the day ends at the time they asked) and **Left early, not answered** (the wait ran
 * out and they ended their day: **Correct** (what the day was, beside the original, with a reason
 * they read) or **Approve**: it stands). Approve is the Forest green solid only when it is the
 * screen's one waiting row (ADR-0015: one solid per layer); otherwise outlined like every list's.
 */
export function EarlyLeaveGroup({
  requests,
  today,
  now,
}: {
  requests: EarlyLeaveRequest[];
  today: string;
  /** The page's clock, so "waiting 12 min" is the server's and never moves on hydration. */
  now: string;
}) {
  const waiting = requests.filter((request) => request.state === "waiting");
  const unanswered = requests.filter((request) => request.state === "left_unanswered");
  const [correct, setCorrect] = useState<CorrectTarget | null>(null);
  const groupsShown = useApprovalGroupsShown();
  const solid = groupsShown === 1 && requests.length === 1;
  if (requests.length === 0) return null;
  return (
    <>
      {waiting.length > 0 ? (
        <Section id="early-leave" heading="Leaving early" count={waiting.length}>
          {waiting.map((request) => (
            <Row key={request.id} request={request} today={today} now={now} solid={solid} />
          ))}
        </Section>
      ) : null}
      {unanswered.length > 0 ? (
        <Section
          id="early-leave-unanswered"
          heading="Left early, not answered"
          count={unanswered.length}
        >
          {unanswered.map((request) => (
            <Row
              key={request.id}
              request={request}
              today={today}
              now={now}
              solid={solid}
              onCorrect={() =>
                setCorrect({
                  dayId: request.dayId,
                  memberName: request.memberName,
                  workDate: request.workDate,
                  current: "present",
                  leaveType: null,
                  compDays: null,
                  earlyLeaveId: request.id,
                })
              }
            />
          ))}
        </Section>
      ) : null}
      <CorrectDayDialog
        target={correct}
        onOpenChange={(open) => (open ? null : setCorrect(null))}
      />
    </>
  );
}

function Section({
  id,
  heading,
  count,
  children,
}: {
  id: string;
  heading: string;
  count: number;
  children: React.ReactNode;
}) {
  const headingId = `approvals-${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-slot="approval-group"
      data-group={id}
      className="scroll-mt-20"
    >
      <div className="mb-2 flex min-h-11 items-center">
        <h2 id={headingId} className="text-muted-foreground text-sm font-medium">
          {heading}{" "}
          <span className="tabular-nums" data-slot="approval-count">
            {count}
          </span>
          <span className="sr-only"> waiting</span>
        </h2>
      </div>
      <ul className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border">
        {children}
      </ul>
    </section>
  );
}

function Row({
  request,
  today,
  now,
  solid,
  onCorrect,
}: {
  request: EarlyLeaveRequest;
  today: string;
  now: string;
  solid: boolean;
  /** "Left early, not answered": Correct opens the correction; a waiting one has Stay instead. */
  onCorrect?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const decide = useAction(async (decision: "approve" | "stay") => {
    setError(null);
    const result = await decideEarlyLeave({ requestId: request.id, decision });
    const name = request.memberName;
    if (
      toastResult(result, {
        success:
          decision === "stay"
            ? `${name} was asked to stay`
            : request.state === "waiting"
              ? `${name} can leave: their day ended at the time they asked`
              : `${name}'s early leave approved`,
      })
    ) {
      setDone(true);
      router.refresh();
    } else if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(description ?? title);
    }
  });
  const busy = decide.pending || done;
  return (
    <li
      data-slot="approval-row"
      data-group={request.state === "waiting" ? "early-leave" : "early-leave-unanswered"}
      data-state={done ? "decided" : "waiting"}
      className={cn(
        "flex flex-col gap-2 px-4 py-3 transition-opacity duration-300 md:flex-row md:items-center md:gap-4",
        LIST_ROW_MIN_H,
        done && "opacity-50",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <PersonAvatar
          person={{
            id: request.memberId,
            name: request.memberName,
            avatarFileId: request.memberAvatarFileId,
          }}
          size={20}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span data-slot="approval-title" className="min-w-0 truncate font-medium">
            {earlyLeaveTitle(request)}
          </span>
          <span data-slot="approval-detail" className="text-muted-foreground text-sm break-words">
            {earlyLeaveSubtitle(request, new Date(now), today, historyDate)}
          </span>
          {error ? (
            <span data-slot="approval-error" role="status" className="text-destructive text-sm">
              {error}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 *:flex-1 md:*:flex-none">
        {onCorrect ? (
          <Button variant="secondary" onClick={onCorrect} disabled={busy}>
            Correct…
          </Button>
        ) : (
          <Button
            variant="secondary"
            commits
            disabled={busy}
            onClick={() => decide.run("stay")}
            data-slot="early-leave-stay"
          >
            Stay
          </Button>
        )}
        <Button
          variant={solid ? "approve" : "secondary"}
          commits
          disabled={busy}
          onClick={() => decide.run("approve")}
          data-slot="early-leave-approve"
        >
          Approve
        </Button>
      </div>
    </li>
  );
}

/**
 * The early-leave requests as the Owner's Today "Needs you" rows (v1.9 W4 Q2, advisor 2 Nov): the
 * compact rows of Today's one list (`layout="rows"` in `ApprovalGroup`), in its order, no heading
 * of their own. The kind says which ("Leaving early", "Left early"); the row opens its group on
 * Approvals (Stay and Correct… live there); the one button is **Approve**, the neutral outline as
 * in every Today row. No Undo: as on Approvals, an early leave is decided at once.
 */
export function EarlyLeavePreviewRows({
  requests,
  waiting,
}: {
  requests: EarlyLeaveRequest[];
  /** How long each has waited, by id (the page's clock; Today's words). */
  waiting: Readonly<Record<string, ApprovalWaiting | null>>;
}) {
  return (
    <>
      {requests.map((request) => (
        <PreviewRow key={request.id} request={request} waiting={waiting[request.id] ?? null} />
      ))}
    </>
  );
}

function PreviewRow({
  request,
  waiting,
}: {
  request: EarlyLeaveRequest;
  waiting: ApprovalWaiting | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const waitingState = request.state === "waiting";
  const approve = useAction(async () => {
    setError(null);
    const result = await decideEarlyLeave({ requestId: request.id, decision: "approve" });
    if (
      toastResult(result, {
        success: waitingState
          ? `${request.memberName} can leave: their day ended at the time they asked`
          : `${request.memberName}'s early leave approved`,
      })
    ) {
      setDone(true);
      router.refresh();
    } else if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(description ?? title);
    }
  });
  const busy = approve.pending || done;
  const group = waitingState ? "early-leave" : "early-leave-unanswered";
  return (
    <li
      data-slot="approval-row"
      data-group={group}
      data-state={done ? "decided" : "waiting"}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-3 pr-4 transition-opacity duration-300",
        APPROVAL_ROW_MIN_H,
        done && "opacity-50",
      )}
    >
      <Link
        href={`/approvals#${group}`}
        data-slot="approval-row-open"
        className="pressable-row focus-visible:ring-ring flex min-w-0 flex-[1_1_10rem] flex-col justify-center gap-0.5 self-stretch py-2 pl-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        <span className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-2">
          <span data-slot="approval-kind" className="text-muted-foreground shrink-0 text-xs">
            {waitingState ? "Leaving early" : "Left early"}
          </span>
          <span className="flex min-w-0 flex-[1_1_6rem] items-center gap-1.5">
            <PersonAvatar
              person={{
                id: request.memberId,
                name: request.memberName,
                avatarFileId: request.memberAvatarFileId,
              }}
              size={20}
            />
            <span data-slot="approval-title" className="min-w-0 truncate text-sm font-medium">
              {request.memberName}
            </span>
          </span>
        </span>
        <span
          data-slot="approval-detail"
          className="text-muted-foreground min-h-4 text-xs break-words"
        >
          {earlyLeavePreviewDetail(request, historyDate)}
        </span>
        {waiting ? <WaitingWords waiting={waiting} className="min-h-4" /> : null}
        {error ? (
          <span data-slot="approval-error" role="status" className="text-destructive text-xs">
            {error}
          </span>
        ) : null}
      </Link>
      <Button
        variant="secondary"
        commits
        disabled={busy}
        onClick={() => approve.run()}
        data-slot="early-leave-approve"
        className="my-1 ml-auto"
      >
        Approve
      </Button>
    </li>
  );
}
