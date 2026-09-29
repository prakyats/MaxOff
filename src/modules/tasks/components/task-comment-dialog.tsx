"use client";

import { useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { FormField } from "@/core/ui/composites/form-field";
import { Button } from "@/core/ui/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/ui/primitives/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";
import { toastResult } from "@/core/ui/toast";

import { addTaskComment } from "../actions/tasks";
import { COMMENT_MAX } from "../domain/limits";

const SELF = "__self__";

/**
 * The "Add a comment" sheet (4.4), loaded on the first tap of its button (4B review S12). It stays
 * mounted after that, so a comment typed before a back is still there on the next open (§14.2 f).
 * A create (ARCHITECTURE §14.1): after a lost reply it offers no Retry, which could post it twice.
 */
export function TaskCommentDialog({
  open,
  onOpenChange,
  taskId,
  forOptions,
  defaultFor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  forOptions: { id: string; name: string }[];
  defaultFor: string | null;
}) {
  const [body, setBody] = useState("");
  const [writingFor, setWritingFor] = useState<string>(defaultFor ?? SELF);
  const [error, setError] = useState<string | null>(null);
  const action = useAction(
    async () => {
      const result = await addTaskComment({
        taskId,
        body,
        onBehalfOf: writingFor === SELF ? null : writingFor,
      });
      if (!result.ok) {
        setError(result.error.fieldErrors?.body?.[0] ?? result.error.message);
        return;
      }
      toastResult(result, { success: "Comment added" });
      setBody("");
      onOpenChange(false);
    },
    { resetKey: open, creates: true },
  );
  const { pending } = action;

  function close(next: boolean) {
    if (pending) return;
    if (!next) setError(null);
    onOpenChange(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) {
      setError("Write something first.");
      return;
    }
    action.run();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-slot="task-comment-dialog">
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a comment</DialogTitle>
            <DialogDescription>Everyone on the task sees it, with your name.</DialogDescription>
          </DialogHeader>
          {forOptions.length > 0 ? (
            <FormField label="Writing as">
              {(control) => (
                <Select value={writingFor} onValueChange={setWritingFor}>
                  <SelectTrigger
                    id={control.id}
                    className="w-full"
                    aria-describedby={control["aria-describedby"]}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELF}>Yourself</SelectItem>
                    {forOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        For {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField label="Comment" error={error ?? undefined}>
            {(control) => (
              <Textarea
                {...control}
                name="comment"
                rows={4}
                maxLength={COMMENT_MAX}
                value={body}
                autoFocus
                onChange={(event) => {
                  setBody(event.target.value);
                  setError(null);
                }}
              />
            )}
          </FormField>
          <ActionStatus action={action} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => close(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" pending={pending} pendingLabel="Posting…">
              Post comment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
