"use client";

import { Loader2Icon } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Label } from "@/core/ui/primitives/label";
import { Textarea } from "@/core/ui/primitives/textarea";
import { toastResult } from "@/core/ui/toast";

import { deactivateMember } from "../actions/members";
import type { TeamMember } from "../domain/members";
import { DEACTIVATE_REASON_MAX_LENGTH } from "../domain/limits";
import { ErrorText } from "@/core/ui/composites/error-text";

/**
 * Deactivate (active) or Revoke invite (invited): one transition, worded by state, with an
 * optional reason kept in the activity log (decided 2026-09-22). Not `ReasonDialog`, whose
 * reason is required.
 */
export function DeactivateMemberDialog({
  member,
  onClose,
}: {
  member: TeamMember;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const reasonId = useId();
  const revoke = member.status === "invited";
  const tooLong = reason.trim().length > DEACTIVATE_REASON_MAX_LENGTH;

  function confirm() {
    startTransition(async () => {
      const result = await deactivateMember({ memberId: member.id, reason });
      if (toastResult(result, { success: revoke ? "Invite revoked" : "Deactivated" })) onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open || pending ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {revoke ? `Revoke ${member.fullName}'s invite?` : `Deactivate ${member.fullName}?`}
          </DialogTitle>
          <DialogDescription>
            {revoke
              ? "Their invite link stops working. You can reactivate them later, which sends them back to invited."
              : "They lose access immediately, on every device. Their history stays, and you can reactivate them later."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={reasonId}>Reason (optional)</Label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Recorded in the history, for whoever asks a year from now."
            rows={3}
            aria-invalid={tooLong ? true : undefined}
            aria-describedby={tooLong ? `${reasonId}-error` : undefined}
          />
          {tooLong ? (
            <ErrorText id={`${reasonId}-error`}>
              Keep the reason under {DEACTIVATE_REASON_MAX_LENGTH} characters.
            </ErrorText>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {/* The one solid red button, named for the action (ARCHITECTURE §14.1). */}
          <Button
            type="button"
            variant="primary"
            onClick={confirm}
            disabled={pending || tooLong}
            aria-busy={pending}
          >
            {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            {revoke ? `Revoke ${member.fullName}'s invite` : `Deactivate ${member.fullName}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
