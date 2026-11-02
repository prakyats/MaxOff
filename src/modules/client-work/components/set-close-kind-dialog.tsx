"use client";

import { useState } from "react";

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
import { describeError, toastResult } from "@/core/ui/toast";

import { setCloseKind } from "../actions/items";
import type { CloseKind } from "../domain/close-kinds";
import type { Recurrence } from "../domain/types";

import { CLEAR_KIND, CloseKindChoice, type CloseKindValue } from "./close-kind-choice";

/**
 * "Set close kind · ‹title›" (v1.9 W1, OPEN 4; the approved screens sample, 3): **the Owner only**,
 * from a closed deliverable's ⋯, on any project, a completed or cancelled one's included. It says
 * when, by whom and why it was closed, then the two kinds (an older close, which has none, starts
 * on "Not needed"); a kind already set can also be cleared. Save is the layer's one neutral solid
 * commit (ADR-0015); `item_set_close_kind` audits it and tells no one. Back closes it (§14.2 a);
 * it is mounted per opening, so it always starts from the deliverable's own kind.
 */
export function SetCloseKindDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: {
    id: string;
    title: string;
    kind: CloseKind | null;
    /** "Closed 30 Sep by Prakyat". */
    line: string;
    reason: string | null;
    recurrence: Recurrence;
  };
}) {
  const [value, setValue] = useState<CloseKindValue>(item.kind ?? "not_needed");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const closeKind = value === CLEAR_KIND ? null : value;
    if (closeKind === item.kind) {
      onOpenChange(false);
      return;
    }
    setPending(true);
    const result = await setCloseKind({ itemId: item.id, closeKind });
    setPending(false);
    if (!result.ok) {
      const { title, description } = describeError(result.error);
      setError(description ?? title);
      return;
    }
    toastResult(result, { success: closeKind ? "Close kind saved" : "Close kind cleared" });
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent data-slot="set-close-kind-dialog">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Set close kind · {item.title}</DialogTitle>
            <DialogDescription>
              {item.line}
              {item.reason ? `: "${item.reason}"` : ""}. Only the Owner can change this.
            </DialogDescription>
          </DialogHeader>
          <CloseKindChoice
            name="set-close-kind"
            recurrence={item.recurrence}
            value={value}
            onChange={(next) => {
              setValue(next);
              setError(null);
            }}
            clearable={item.kind !== null}
          />
          {error ? <ErrorText slot="form-alert">{error}</ErrorText> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => onOpenChange(false)}
              data-dismiss=""
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving…">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
