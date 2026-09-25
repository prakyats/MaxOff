"use client";

import type { ResultError } from "@/core/errors";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { describeError } from "@/core/ui/toast";

import type { TeamMember } from "../domain/members";

import { InviteLinkPanel } from "./invite-link-panel";
import { ErrorText } from "@/core/ui/composites/error-text";

export type InviteLinkState = { link: string } | { error: ResultError } | null;

/**
 * "Copy invite link" for a pending invite. The parent issues the link from the menu action
 * (a deliberate click, exactly once) and passes the outcome in; this only shows it. The
 * "I never got the email" path (WORKFLOWS §1a).
 */
export function InviteLinkDialog({
  member,
  state,
  onClose,
}: {
  member: TeamMember;
  state: InviteLinkState;
  onClose: () => void;
}) {
  const failure = state && "error" in state ? describeError(state.error) : null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite link for {member.fullName}</DialogTitle>
          <DialogDescription>
            The same link the invite email carries. Share it over any channel you trust.
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <ErrorText slot="form-alert">{failure.description ?? failure.title}</ErrorText>
        ) : state && "link" in state ? (
          <InviteLinkPanel link={state.link} />
        ) : (
          <div className="flex flex-col gap-2" aria-busy>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
