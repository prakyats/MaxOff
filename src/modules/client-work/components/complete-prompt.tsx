"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import { describeError } from "@/core/ui/toast";

import { markDoneAndCompleteProject } from "../actions/items";

/** The deliverable whose Mark done asked, and its project's name. */
export type CompletePromptTarget = { itemId: string; itemTitle: string; projectName: string };

/**
 * Kickoff 9 R1 (v2.1; WORKFLOWS §6 "One-time projects"): Mark done on the **last open deliverable
 * of a one-time project** asks first, for whoever may also complete the project (the Owner, the
 * client's Admin). **Mark done and complete project** is the sheet's one solid commit, the Forest
 * green `approve` (a positive final decision, as Mark done itself; ADR-0015): one transition
 * (`item_mark_done_and_complete`), at once and without Undo, as Complete from the project's ⋯.
 * **Mark done only** marks it as before (the screen's own 6-second Undo). Cancel, ✕, back and a
 * tap outside change nothing. A refusal (someone added a deliverable meanwhile) is said here and
 * nothing is marked; the list behind is read again. A bottom sheet on a phone. Never an amount:
 * this is client work, and the client's Admin reads the same words.
 */
export function CompletePrompt({
  target,
  open,
  onClose,
  onMarkOnly,
}: {
  /** Kept while the sheet closes, so its words stay through the animation. */
  target: CompletePromptTarget;
  open: boolean;
  onClose: () => void;
  /** The screen's plain Mark done (the delayed send with Undo). */
  onMarkOnly: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const action = useAction(
    async () => {
      setError(null);
      const result = await markDoneAndCompleteProject({ itemId: target.itemId });
      if (!result.ok) {
        const { title, description } = describeError(result.error);
        setError(description ?? title);
        // Nothing was marked; what changed meanwhile (a new deliverable) should show behind.
        router.refresh();
        return;
      }
      toast.success("Project completed");
      onClose();
    },
    { resetKey: `${target.itemId}-${open}` },
  );
  const [seen, setSeen] = useState(open);
  if (seen !== open) {
    setSeen(open);
    if (open) setError(null);
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next || action.pending ? undefined : onClose())}>
      <DialogContent data-slot="complete-prompt">
        <DialogHeader>
          <DialogTitle>Complete the project too?</DialogTitle>
          <DialogDescription>
            <span className="text-foreground font-medium break-words">{target.itemTitle}</span> is
            the last open deliverable of{" "}
            <span className="text-foreground font-medium break-words">{target.projectName}</span>. A
            completed project becomes read-only. You can reopen it later.
          </DialogDescription>
        </DialogHeader>
        {error ? <ErrorText slot="form-alert">{error}</ErrorText> : null}
        <ActionStatus action={action} />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={action.pending}
            data-dismiss=""
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={action.pending}
            data-slot="complete-prompt-only"
            onClick={() => {
              onClose();
              onMarkOnly();
            }}
          >
            Mark done only
          </Button>
          <Button
            type="button"
            variant="approve"
            pending={action.pending}
            pendingLabel="Completing…"
            data-slot="complete-prompt-complete"
            onClick={() => action.run()}
          >
            Mark done and complete project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
