"use client";

import { SendIcon } from "lucide-react";
import { useId, useState } from "react";

import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { Textarea } from "@/core/ui/primitives/textarea";

import { addTaskComment } from "../actions/tasks";
import { COMMENT_MAX } from "../domain/limits";
import { WRITING_AS_SELF } from "../domain/page";

/**
 * Chat's composer (Kickoff 4 decision 28), loaded after the page (`task-chat.tsx`). The draft is
 * the caller's (it outlives a back and the sheet). A create (ARCHITECTURE §14.1): after a lost
 * reply it offers no Retry, which could post it twice. A freelancer's coordinator picks who is
 * writing: themselves or the freelancer ("Ravi for Asha", ADR-0013); the guard checks it again.
 *
 * **Send's colour (colour rule, Kickoff 4 decision 26):** solid red only inside the phone's Chat
 * sheet, its own layer. Inline on desktop the composer shares the screen with the next step's
 * solid action, so Send is the neutral outline there (still a commit: offline-aware, pending).
 */
export function ChatComposer({
  taskId,
  body,
  onBodyChange,
  writingFor,
  onWritingForChange,
  forOptions,
  inSheet,
}: {
  taskId: string;
  body: string;
  onBodyChange: (body: string) => void;
  writingFor: string;
  onWritingForChange: (writingFor: string) => void;
  forOptions: { id: string; name: string }[];
  /** Drawn in the phone's Chat sheet (a layer of its own) rather than inline on the page. */
  inSheet: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const action = useAction(
    async () => {
      const result = await addTaskComment({
        taskId,
        body,
        onBehalfOf: writingFor === WRITING_AS_SELF ? null : writingFor,
      });
      if (!result.ok) {
        setError(result.error.fieldErrors?.body?.[0] ?? result.error.message);
        return;
      }
      onBodyChange("");
    },
    { creates: true },
  );
  const { pending } = action;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!body.trim()) {
      setError("Write something first.");
      return;
    }
    action.run();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      data-slot="task-chat-composer"
      className="flex min-w-0 flex-col gap-2"
    >
      {forOptions.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={`${id}-as`} className="text-muted-foreground text-xs">
            Writing as
          </label>
          <Select value={writingFor} onValueChange={onWritingForChange}>
            <SelectTrigger id={`${id}-as`} className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WRITING_AS_SELF}>Yourself</SelectItem>
              {forOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  For {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex min-w-0 items-end gap-2">
        <Textarea
          aria-label="Comment"
          name="comment"
          rows={1}
          maxLength={COMMENT_MAX}
          placeholder="Write a comment"
          value={body}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="field-sizing-content max-h-40 min-h-11 min-w-0 flex-1 resize-none"
          onChange={(event) => {
            onBodyChange(event.target.value);
            setError(null);
          }}
        />
        <Button
          type="submit"
          variant={inSheet ? "primary" : "secondary"}
          commits
          className="h-11 shrink-0"
          pending={pending}
          pendingLabel="Sending…"
        >
          <SendIcon aria-hidden />
          Send
        </Button>
      </div>
      {error ? <ErrorText id={`${id}-error`}>{error}</ErrorText> : null}
      <ActionStatus action={action} />
    </form>
  );
}
