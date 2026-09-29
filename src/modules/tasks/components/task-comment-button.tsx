"use client";

import { Loader2Icon, MessageSquarePlusIcon } from "lucide-react";
import { useState, useTransition } from "react";

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
 * "Add a comment" (4.4; PRODUCT §4.6: timestamped updates). A sheet on a phone, so the keyboard
 * has the screen and the commit sits above it (§14.1). Comments stay open in every state,
 * locked or not (WORKFLOWS §3.1). A freelancer's coordinator may write as themselves or for the
 * freelancer ("Ravi for Asha", ADR-0013); the guard checks it again.
 */
export function TaskCommentButton({
  taskId,
  forOptions,
  defaultFor,
}: {
  taskId: string;
  /** The freelancers on this task the viewer coordinates now. */
  forOptions: { id: string; name: string }[];
  /** Who the comment is for by default: null = the viewer themselves. */
  defaultFor: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [writingFor, setWritingFor] = useState<string>(defaultFor ?? SELF);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(next: boolean) {
    if (pending) return;
    if (!next) setError(null);
    setOpen(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) {
      setError("Write something first.");
      return;
    }
    startTransition(async () => {
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
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="h-11 self-start"
        onClick={() => setOpen(true)}
        data-slot="task-add-comment"
      >
        <MessageSquarePlusIcon aria-hidden />
        Add a comment
      </Button>
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
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => close(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={pending} aria-busy={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                Post comment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
