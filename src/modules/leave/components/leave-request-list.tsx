"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PlaneIcon } from "lucide-react";
import { Fragment, useId, useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusBadge, StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";
import { toastResult } from "@/core/ui/toast";
import { displayName } from "@/core/lib/display-name";

import { requestLeaveCancellation, withdrawLeave } from "../actions/leave";
import { ownerCancelLeave } from "../actions/review";
import {
  groupLeavePairs,
  HALF_LABELS,
  LEAVE_ENDED_HINT,
  LEAVE_ENDED_MESSAGE,
  leaveDates,
  leaveDecisionNote,
  leaveHasEnded,
  leaveKind,
  type LeaveListEntry,
  type LeavePair,
  leavePairActions,
  leaveRequestActions,
  leaveStateLabel,
  leaveTitle,
  type OwnLeaveRequest,
  PAIR_TITLE,
  pairHalfLine,
  pairState,
} from "../domain/requests";
import { ownerLeaveActions } from "../domain/review";
import { LEAVE_REASON_MAX_LENGTH } from "../domain/limits";

import { LeaveFormDialog } from "./leave-form-dialog";
import { OwnerEditLeaveDialog } from "./owner-edit-leave-dialog";

type DialogState =
  | { kind: "none" }
  | { kind: "change"; request: OwnLeaveRequest }
  | { kind: "cancel"; request: OwnLeaveRequest }
  | { kind: "withdraw"; request: OwnLeaveRequest }
  | { kind: "owner-edit"; request: OwnLeaveRequest }
  | { kind: "owner-cancel"; request: OwnLeaveRequest };

/** "the morning": a split day's half, as a button names it; "this half" for an older half day. */
function halfName(request: OwnLeaveRequest): string {
  return request.half ? `the ${HALF_LABELS[request.half].toLowerCase()}` : "this half";
}

/** The pair's one state (`pairState`): a dot on the card, a badge in the table. */
function PairState({ pair, dot = false }: { pair: LeavePair; dot?: boolean }) {
  const { status, label } = pairState(pair);
  if (dot) return <StatusDot status={status} label={label} />;
  return <StatusBadge status={status} label={label} />;
}

/** A split day's title and dates come from its first half (both halves are one date). */
function entryTitle(entry: LeaveListEntry): string {
  return entry.kind === "pair" ? PAIR_TITLE : leaveTitle(entry.request);
}
function entryDates(entry: LeaveListEntry): string {
  const request = entry.kind === "pair" ? entry.pair.halves[0] : entry.request;
  return request ? leaveDates(request.startDate, request.endDate) : "";
}

function RequestState({ request, dot = false }: { request: OwnLeaveRequest; dot?: boolean }) {
  const label = leaveStateLabel(request);
  // A granted cancellation is not a refusal: keep it out of the danger tone.
  const neutral = request.requestsCancellation && request.state === "cancelled";
  if (dot) return <StatusDot status={neutral ? "none" : request.state} label={label} />;
  return (
    <StatusBadge status={request.state} label={label} {...(neutral ? { tone: "neutral" } : {})} />
  );
}

/**
 * One person's requests, newest first, one page at a time (the page and its pager are the
 * route's). The member sees their own, and what each row offers comes from
 * `leaveRequestActions()`, which mirrors the transition functions, so nothing here is refused by
 * the database for a reason the screen could have known. The Owner (`owner`, task 2.4) sees
 * someone else's, with Edit and Cancel on approved leave (`ownerLeaveActions()`, mirroring
 * `leave_owner_edit` / `leave_owner_cancel`).
 *
 * v2.0.1: the two halves of a split day ("Full day: ½ comp + ½ leave", one `pair_id`) are **one
 * card**, with each half as a line under it and its own state. While it waits the card has one
 * **Withdraw** (one call withdraws both halves); once approved each half has its own actions
 * (`leavePairActions()`), named for the half ("Ask to cancel the morning").
 */
export function LeaveRequestList({
  requests,
  today,
  owner,
}: {
  requests: OwnLeaveRequest[];
  today: string;
  /**
   * Set when the Owner reads this person's requests: their name, for the wording, and their comp
   * leave balance today, so the edit dialog greys out comp leave with no credit (3c review).
   */
  owner?: { name: string; compDays?: number | undefined };
}) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const close = () => setDialog({ kind: "none" });

  /**
   * `half` names a split day's half in the buttons' words: in the card's sheet the label says it
   * ("Cancel the morning"); on the table's half line, where the line says it, only the accessible
   * name does.
   */
  function ownerButtons(
    request: OwnLeaveRequest,
    size: "sm" | "default",
    half?: { name: string; visible: boolean },
  ) {
    const actions = ownerLeaveActions(request);
    if (!actions.edit && !actions.cancel) return null;
    const edit = half ? `Edit ${half.name}` : "Edit";
    const cancel = half ? `Cancel ${half.name}` : "Cancel leave";
    return (
      <>
        {actions.edit ? (
          <Button
            variant="secondary"
            size={size}
            aria-label={half && !half.visible ? edit : undefined}
            onClick={() => setDialog({ kind: "owner-edit", request })}
          >
            {half && !half.visible ? "Edit" : edit}
          </Button>
        ) : null}
        {actions.cancel ? (
          <Button
            variant="destructive"
            size={size}
            aria-label={half && !half.visible ? cancel : undefined}
            onClick={() => setDialog({ kind: "owner-cancel", request })}
          >
            {half && !half.visible ? "Cancel" : cancel}
          </Button>
        ) : null}
      </>
    );
  }

  function actionButtons(
    request: OwnLeaveRequest,
    layout: "row" | "sheet",
    half?: { name: string; visible: boolean },
  ) {
    if (owner) return ownerButtons(request, layout === "row" ? "sm" : "default", half);
    const actions = half
      ? { ...leaveRequestActions(request, today), withdraw: false }
      : leaveRequestActions(request, today);
    if (!actions.withdraw && !actions.change && !actions.cancel) return null;
    const size = layout === "row" ? "sm" : "default";
    const change = half ? `Change ${half.name}` : "Change";
    const cancel = half ? `Ask to cancel ${half.name}` : "Ask to cancel";
    return (
      <>
        {actions.change ? (
          <Button
            variant="secondary"
            size={size}
            aria-label={half && !half.visible ? change : undefined}
            onClick={() => setDialog({ kind: "change", request })}
          >
            {half && !half.visible ? "Change" : change}
          </Button>
        ) : null}
        {actions.cancel ? (
          <Button
            variant="destructive"
            size={size}
            aria-label={half && !half.visible ? cancel : undefined}
            onClick={() => setDialog({ kind: "cancel", request })}
          >
            {half && !half.visible ? "Ask to cancel" : cancel}
          </Button>
        ) : null}
        {actions.withdraw ? (
          <Button
            variant="destructive"
            size={size}
            onClick={() => setDialog({ kind: "withdraw", request })}
          >
            Withdraw
          </Button>
        ) : null}
      </>
    );
  }

  function details(request: OwnLeaveRequest) {
    const kind = leaveKind(request);
    const note = leaveDecisionNote(request, owner !== undefined);
    return (
      <dl className="flex flex-col gap-3">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Dates</dt>
          <dd className="text-right">{leaveDates(request.startDate, request.endDate)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-right">
            <RequestState request={request} />
          </dd>
        </div>
        {kind ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground shrink-0">Request</dt>
            <dd className="text-right">{kind}</dd>
          </div>
        ) : null}
        {request.reason ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{owner ? "Their reason" : "Your reason"}</dt>
            <dd className="break-words">{request.reason}</dd>
          </div>
        ) : null}
        {note ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Decision</dt>
            <dd className="break-words" data-slot="leave-decision-note">
              {note}
            </dd>
          </div>
        ) : null}
        {request.hasOpenChange ? (
          <p className="text-muted-foreground">
            {owner
              ? "A change to this leave is waiting for you in Approvals."
              : "A change to this leave is waiting for the Owner."}
          </p>
        ) : null}
        {!owner && leaveHasEnded(request, today) ? (
          <p className="text-muted-foreground">{LEAVE_ENDED_MESSAGE}</p>
        ) : null}
      </dl>
    );
  }

  /** A split day's Withdraw: one call withdraws both halves while they wait. */
  function pairWithdraw(pair: LeavePair, size: "sm" | "default") {
    if (owner) return null;
    const { withdrawId } = leavePairActions(pair, today);
    const request = pair.halves.find((half) => half.id === withdrawId);
    if (!request) return null;
    return (
      <Button
        variant="destructive"
        size={size}
        onClick={() => setDialog({ kind: "withdraw", request })}
      >
        Withdraw
      </Button>
    );
  }

  /** The halves of a split day, one line each: which half and what it is, its state, its actions. */
  function pairHalves(pair: LeavePair, layout: "row" | "sheet") {
    return (
      <ul className="flex flex-col gap-2" data-slot="leave-pair-halves">
        {pair.halves.map((half) => {
          const buttons =
            layout === "row"
              ? actionButtons(half, "row", { name: halfName(half), visible: false })
              : null;
          const note = leaveDecisionNote(half, owner !== undefined);
          return (
            <li key={half.id} data-slot="leave-pair-half" className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className={layout === "row" ? "text-sm" : undefined}>
                  {pairHalfLine(half)}
                </span>
                <span className="flex items-center gap-2">
                  {layout === "row" ? (
                    <RequestState request={half} dot />
                  ) : (
                    <RequestState request={half} />
                  )}
                  {buttons}
                </span>
              </div>
              {pairDiffers(pair) && note ? (
                <p className="text-muted-foreground text-xs break-words">{note}</p>
              ) : null}
              {half.hasOpenChange ? (
                <p className="text-muted-foreground text-xs">
                  {owner
                    ? "A change to this half is waiting for you in Approvals."
                    : "A change to this half is waiting for the Owner."}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  /** The card's sheet for a split day: the date, the pair's state, each half, the reason. */
  function pairDetails(pair: LeavePair) {
    const [first] = pair.halves;
    if (!first) return null;
    const note = pairDiffers(pair) ? null : leaveDecisionNote(first, owner !== undefined);
    const ended = !owner && pair.halves.some((half) => leaveHasEnded(half, today));
    return (
      <dl className="flex flex-col gap-3">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Date</dt>
          <dd className="text-right">{leaveDates(first.startDate, first.endDate)}</dd>
        </div>
        <div className="flex flex-col gap-2">
          <dt className="text-muted-foreground">Halves</dt>
          <dd>{pairHalves(pair, "sheet")}</dd>
        </div>
        {first.reason ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{owner ? "Their reason" : "Your reason"}</dt>
            <dd className="break-words">{first.reason}</dd>
          </div>
        ) : null}
        {note ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Decision</dt>
            <dd className="break-words" data-slot="leave-decision-note">
              {note}
            </dd>
          </div>
        ) : null}
        {ended ? <p className="text-muted-foreground">{LEAVE_ENDED_MESSAGE}</p> : null}
      </dl>
    );
  }

  /** The card's sheet actions for a split day: Withdraw while it waits, then each half's own. */
  function pairSheetActions(pair: LeavePair) {
    const withdraw = pairWithdraw(pair, "default");
    const halves = pair.halves.map((half) => (
      <Fragment key={half.id}>
        {actionButtons(half, "sheet", { name: halfName(half), visible: true })}
      </Fragment>
    ));
    return (
      <>
        {withdraw}
        {halves}
      </>
    );
  }

  const columns: ColumnDef<LeaveListEntry>[] = [
    {
      id: "leave",
      header: "Leave",
      enableSorting: false,
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.kind === "pair") {
          return (
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-medium">{PAIR_TITLE}</p>
              {pairHalves(entry.pair, "row")}
            </div>
          );
        }
        const kind = leaveKind(entry.request);
        return (
          <div className="min-w-0">
            <p className="font-medium">{leaveTitle(entry.request)}</p>
            {kind ? <p className="text-muted-foreground text-xs">{kind}</p> : null}
          </div>
        );
      },
    },
    {
      id: "dates",
      header: "Dates",
      enableSorting: false,
      cell: ({ row }) => {
        // PP-crew-9 (V5b): a decision's reason (a refusal, a cancellation) is its own muted line
        // under the dates, not wrapped under the status chip.
        const entry = row.original;
        const lead = entry.kind === "pair" ? entry.pair.halves[0] : entry.request;
        // A split day's halves carry their own notes once they differ (`pairHalves`).
        const note =
          lead && !(entry.kind === "pair" && pairDiffers(entry.pair))
            ? leaveDecisionNote(lead, owner !== undefined)
            : null;
        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="whitespace-nowrap">{entryDates(entry)}</span>
            {note ? (
              <p
                data-slot="leave-row-note"
                className="text-muted-foreground max-w-80 text-xs break-words"
              >
                {note}
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "state",
      header: "Status",
      enableSorting: false,
      size: 140,
      cell: ({ row }) =>
        row.original.kind === "pair" ? (
          <PairState pair={row.original.pair} />
        ) : (
          <RequestState request={row.original.request} />
        ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      // PP-crew-9 (V5b): ended leave has no actions; why is said once, under the table.
      // A split day's own actions are on its half lines; only its Withdraw is here.
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          {row.original.kind === "pair"
            ? pairWithdraw(row.original.pair, "sm")
            : actionButtons(row.original.request, "row")}
        </div>
      ),
    },
  ];

  // A split day's card has the same two lines as any other (the skeleton traces them): its
  // halves, each with its state and actions, are one tap deeper, in the sheet.
  const mobile: MobileCard<LeaveListEntry> = {
    title: entryTitle,
    subtitle: entryDates,
    trailing: (entry) =>
      entry.kind === "pair" ? (
        <PairState pair={entry.pair} dot />
      ) : (
        <RequestState request={entry.request} dot />
      ),
    detail: (entry) => (entry.kind === "pair" ? pairDetails(entry.pair) : details(entry.request)),
    detailTitle: entryTitle,
    actions: (entry) =>
      entry.kind === "pair" ? pairSheetActions(entry.pair) : actionButtons(entry.request, "sheet"),
  };
  const entries = groupLeavePairs(requests);

  return (
    <>
      <DataTable
        columns={columns}
        data={entries}
        getRowId={(entry) => entry.id}
        caption={owner ? `${owner.name}'s leave requests` : "Your leave requests"}
        pageSize={0}
        mobile={mobile}
        mobilePageSize={entries.length || 1}
        emptyState={
          owner ? (
            <EmptyState
              icon={PlaneIcon}
              title="No leave requests yet"
              description={`${displayName(owner.name)} has not asked for leave.`}
            />
          ) : (
            <EmptyState
              icon={PlaneIcon}
              title="No leave requests yet"
              description="Request a day, a range or a half day. The Owner approves it, and you can change or cancel it later."
            />
          )
        }
      />
      {!owner && requests.some((request) => leaveHasEnded(request, today)) ? (
        <p
          data-slot="leave-ended-hint"
          className="text-muted-foreground mt-3 hidden text-sm md:block"
        >
          {LEAVE_ENDED_HINT}
        </p>
      ) : null}

      {dialog.kind === "change" ? (
        <LeaveFormDialog
          key={dialog.request.id}
          today={today}
          original={dialog.request}
          onClose={close}
        />
      ) : null}
      {dialog.kind === "cancel" ? (
        <CancelLeaveDialog key={dialog.request.id} request={dialog.request} onClose={close} />
      ) : null}
      {dialog.kind === "owner-edit" && owner ? (
        <OwnerEditLeaveDialog
          key={dialog.request.id}
          request={dialog.request}
          memberName={owner.name}
          compDays={owner.compDays}
          onClose={close}
        />
      ) : null}
      {owner ? (
        <ReasonDialog
          open={dialog.kind === "owner-cancel"}
          onOpenChange={(open) => (open ? undefined : close())}
          title="Cancel this leave?"
          description={
            dialog.kind === "owner-cancel"
              ? `${leaveTitle(dialog.request)} on ${leaveDates(dialog.request.startDate, dialog.request.endDate)}. ${owner.name} will see this reason.`
              : undefined
          }
          label="Reason"
          placeholder={`${owner.name} will see this reason.`}
          submitLabel="Cancel leave"
          destructive
          cancelLabel="Keep it"
          onSubmit={async (reason) => {
            if (dialog.kind !== "owner-cancel") return;
            return toastResult(await ownerCancelLeave({ requestId: dialog.request.id, reason }), {
              success: "Leave cancelled",
            });
          }}
        />
      ) : null}
      {dialog.kind === "withdraw" ? (
        <ConfirmDialog
          destructive
          open
          onOpenChange={(open) => (open ? undefined : close())}
          title="Withdraw this request?"
          description={
            // v2.0.1: a waiting split day goes back whole (`leave_withdraw` withdraws its partner).
            dialog.request.pairId &&
            requests.some(
              (other) =>
                other.pairId === dialog.request.pairId &&
                other.id !== dialog.request.id &&
                other.state === "submitted",
            )
              ? `${PAIR_TITLE} on ${leaveDates(dialog.request.startDate, dialog.request.endDate)}. Both halves are withdrawn, and the Owner will no longer see them.`
              : `${leaveTitle(dialog.request)} on ${leaveDates(dialog.request.startDate, dialog.request.endDate)}. The Owner will no longer see it.`
          }
          confirmLabel="Withdraw request"
          onConfirm={async () => {
            toastResult(await withdrawLeave({ requestId: dialog.request.id }), {
              success: "Request withdrawn",
            });
          }}
        />
      ) : null}
    </>
  );
}

/** Asking the Owner to cancel approved leave: a new request, the leave stays until they decide. */
function CancelLeaveDialog({
  request,
  onClose,
}: {
  request: OwnLeaveRequest;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  return (
    <ConfirmDialog
      destructive
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ask to cancel this leave?"
      description={`${leaveTitle(request)} on ${leaveDates(request.startDate, request.endDate)}. It stays approved until the Owner decides.`}
      confirmLabel="Ask to cancel"
      cancelLabel="Keep it"
      onConfirm={async () => {
        toastResult(await requestLeaveCancellation({ requestId: request.id, reason }), {
          success: "Cancellation sent to the Owner",
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>Reason (optional)</Label>
        <Textarea
          id={reasonId}
          rows={3}
          maxLength={LEAVE_REASON_MAX_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}

/** Whether a split day's halves stand differently (one cancelled or changed on its own). */
function pairDiffers(pair: LeavePair): boolean {
  return new Set(pair.halves.map((half) => half.state)).size > 1;
}
