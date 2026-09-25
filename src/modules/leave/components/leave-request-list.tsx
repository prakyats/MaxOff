"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PlaneIcon } from "lucide-react";
import { useId, useState } from "react";

import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { DataTable, type MobileCard } from "@/core/ui/composites/data-table";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { StatusBadge, StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";
import { toastResult } from "@/core/ui/toast";

import { requestLeaveCancellation, withdrawLeave } from "../actions/leave";
import { ownerCancelLeave } from "../actions/review";
import {
  LEAVE_ENDED_MESSAGE,
  leaveDates,
  leaveDecisionNote,
  leaveHasEnded,
  leaveKind,
  leaveRequestActions,
  leaveStateLabel,
  leaveTitle,
  type OwnLeaveRequest,
} from "../domain/requests";
import { firstName, ownerLeaveActions } from "../domain/review";
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
 */
export function LeaveRequestList({
  requests,
  today,
  owner,
}: {
  requests: OwnLeaveRequest[];
  today: string;
  /** Set when the Owner reads this person's requests: their name, for the wording. */
  owner?: { name: string };
}) {
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const close = () => setDialog({ kind: "none" });

  function ownerButtons(request: OwnLeaveRequest, size: "sm" | "default") {
    const actions = ownerLeaveActions(request);
    if (!actions.edit && !actions.cancel) return null;
    return (
      <>
        {actions.edit ? (
          <Button
            variant="outline"
            size={size}
            onClick={() => setDialog({ kind: "owner-edit", request })}
          >
            Edit
          </Button>
        ) : null}
        {actions.cancel ? (
          <Button
            variant="outline"
            size={size}
            onClick={() => setDialog({ kind: "owner-cancel", request })}
          >
            Cancel leave
          </Button>
        ) : null}
      </>
    );
  }

  function actionButtons(request: OwnLeaveRequest, layout: "row" | "sheet") {
    if (owner) return ownerButtons(request, layout === "row" ? "sm" : "default");
    const actions = leaveRequestActions(request, today);
    if (!actions.withdraw && !actions.change && !actions.cancel) return null;
    const size = layout === "row" ? "sm" : "default";
    return (
      <>
        {actions.change ? (
          <Button
            variant="outline"
            size={size}
            onClick={() => setDialog({ kind: "change", request })}
          >
            Change
          </Button>
        ) : null}
        {actions.cancel ? (
          <Button
            variant="outline"
            size={size}
            onClick={() => setDialog({ kind: "cancel", request })}
          >
            Ask to cancel
          </Button>
        ) : null}
        {actions.withdraw ? (
          <Button
            variant="outline"
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

  const columns: ColumnDef<OwnLeaveRequest>[] = [
    {
      id: "leave",
      header: "Leave",
      enableSorting: false,
      cell: ({ row }) => {
        const kind = leaveKind(row.original);
        return (
          <div className="min-w-0">
            <p className="font-medium">{leaveTitle(row.original)}</p>
            {kind ? <p className="text-muted-foreground text-xs">{kind}</p> : null}
          </div>
        );
      },
    },
    {
      id: "dates",
      header: "Dates",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {leaveDates(row.original.startDate, row.original.endDate)}
        </span>
      ),
    },
    {
      id: "state",
      header: "Status",
      enableSorting: false,
      size: 140,
      cell: ({ row }) => {
        const note = leaveDecisionNote(row.original, owner !== undefined);
        return (
          <div className="flex flex-col items-start gap-1">
            <RequestState request={row.original} />
            {note ? (
              <p className="text-muted-foreground max-w-64 text-xs break-words">{note}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) =>
        !owner && leaveHasEnded(row.original, today) ? (
          <p className="text-muted-foreground text-right text-xs">{LEAVE_ENDED_MESSAGE}</p>
        ) : (
          <div className="flex justify-end gap-2">{actionButtons(row.original, "row")}</div>
        ),
    },
  ];

  const mobile: MobileCard<OwnLeaveRequest> = {
    title: (request) => leaveTitle(request),
    subtitle: (request) => leaveDates(request.startDate, request.endDate),
    trailing: (request) => <RequestState request={request} dot />,
    detail: details,
    detailTitle: (request) => leaveTitle(request),
    actions: (request) => actionButtons(request, "sheet"),
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={requests}
        getRowId={(request) => request.id}
        caption={owner ? `${owner.name}'s leave requests` : "Your leave requests"}
        pageSize={0}
        mobile={mobile}
        mobilePageSize={requests.length || 1}
        emptyState={
          owner ? (
            <EmptyState
              icon={PlaneIcon}
              title="No leave requests yet"
              description={`${firstName(owner.name)} has not asked for leave.`}
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
          cancelLabel="Keep it"
          destructive
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
          open
          onOpenChange={(open) => (open ? undefined : close())}
          title="Withdraw this request?"
          description={`${leaveTitle(dialog.request)} on ${leaveDates(dialog.request.startDate, dialog.request.endDate)}. The Owner will no longer see it.`}
          confirmLabel="Withdraw"
          destructive
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
