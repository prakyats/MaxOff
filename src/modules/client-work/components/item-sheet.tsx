"use client";

import { ArrowDownIcon, ArrowUpIcon, CheckIcon } from "lucide-react";
import { useState } from "react";

import { fail, type Result } from "@/core/errors/result";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";
import { Textarea } from "@/core/ui/primitives/textarea";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  approveItems,
  cancelItem,
  markItemDone,
  rejectItem,
  tickStage,
  unmarkItemDone,
  updateItem,
} from "../actions/items";
import { ITEM_NOTES_MAX, ITEM_TITLE_MAX } from "../domain/schemas";
import { ITEM_STATUS } from "../domain/types";
import type { ItemView } from "../domain/views";

/** What the viewer may do on the screen that opened the sheet (their keys, the project's state). */
export type ItemPermissions = {
  /** `projects.manage` on a project that is open or in progress. */
  manage: boolean;
  /** `items.tick` on a project that is open or in progress. */
  tick: boolean;
  /** `items.approve` on a project that is open or in progress. */
  approve: boolean;
};

/**
 * An item's sheet (7.3; PRODUCT §4.5, WORKFLOWS §5.3, kickoff 7 decisions 6, 7, 12; Q5 (b)): its
 * state, planned date, notes and history, the stage ticks (44 px rows), and the actions the viewer
 * may take: Mark done / Not done (`items.tick`), Approve and Send back with a reason
 * (`items.approve`), Edit, Move and Close with a reason (`projects.manage`; once approved, closed or
 * carried only the title and notes change). A bottom sheet on a phone (`ReviewSheet`): back closes
 * it, and a reason dialog opened from it closes first (§14.2 a); with an edit typed and not saved,
 * back asks "Discard your changes?" first, and back on that keeps editing (§14.2 f). **Approve**
 * goes through `onApprove` where the screen gives it (the project page: instant, with the
 * 6-second Undo, as Approvals) and the sheet closes.
 */
export function ItemSheet({
  item,
  stages,
  permissions,
  open,
  onOpenChange,
  projectHref,
  onMove,
  onApprove,
}: {
  item: ItemView | null;
  stages: readonly { id: string; name: string }[];
  permissions: ItemPermissions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened from outside the project (Today, the lists): a way to the project's page. */
  projectHref?: string;
  /** Opened on the project page: move the item up or down its list. */
  onMove?: ((itemId: string, direction: "up" | "down") => void) | undefined;
  /** The screen's Approve with Undo (the project page); without it the sheet approves at once. */
  onApprove?: ((item: ItemView) => void) | undefined;
}) {
  // Editing belongs to the item it started on: another item, or a reopened sheet, shows its facts.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [planned, setPlanned] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<"reject" | "close" | null>(null);
  // "Discard your changes?" stands in for the sheet while it asks (§14.2 f).
  const [asking, setAsking] = useState(false);

  if (!item) {
    return (
      <ReviewSheet open={false} onOpenChange={onOpenChange} title="">
        {null}
      </ReviewSheet>
    );
  }
  const current = item;
  const editing = open && editingId === current.id;
  const setEditing = (next: boolean) => setEditingId(next ? current.id : null);
  const dirty =
    editing &&
    (title !== current.title ||
      notes !== (current.notes ?? "") ||
      (current.rules.editAll && planned !== (current.plannedDate ?? "")));

  function requestClose(next: boolean) {
    if (!next && dirty && !saving) {
      setAsking(true);
      return;
    }
    onOpenChange(next);
  }

  function startEdit() {
    setTitle(current.title);
    setNotes(current.notes ?? "");
    setPlanned(current.plannedDate ?? "");
    setSaveError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const result = await updateItem({
      itemId: current.id,
      ...(title !== current.title ? { title } : {}),
      ...(notes !== (current.notes ?? "") ? { notes } : {}),
      ...(current.rules.editAll && planned !== (current.plannedDate ?? "")
        ? { plannedDate: planned || null }
        : {}),
    });
    setSaving(false);
    if (!result.ok) {
      const { title: heading, description } = describeError(result.error);
      setSaveError(description ?? heading);
      return;
    }
    setEditing(false);
  }

  async function run(key: string, send: () => Promise<Result<unknown>>, success: string) {
    setBusy(key);
    toastResult(await send(), { success });
    setBusy(null);
  }

  const canTick = permissions.tick && current.rules.ticks;
  const ticked = new Set(current.ticked);
  const actions = (
    <>
      {projectHref ? (
        <Button variant="ghost" asChild>
          <OverlayLink href={projectHref}>Open the project</OverlayLink>
        </Button>
      ) : null}
      {permissions.manage && current.rules.cancel ? (
        <Button variant="ghost" onClick={() => setReason("close")} data-slot="item-close">
          Close item…
        </Button>
      ) : null}
      {permissions.approve && current.rules.decide ? (
        <Button variant="secondary" onClick={() => setReason("reject")} data-slot="item-send-back">
          Send back…
        </Button>
      ) : null}
      {permissions.tick && current.rules.notDone ? (
        <Button
          variant="secondary"
          pending={busy === "not-done"}
          onClick={() =>
            run("not-done", () => unmarkItemDone({ itemId: current.id }), "Marked not done")
          }
        >
          Not done
        </Button>
      ) : null}
      {permissions.approve && current.rules.decide ? (
        <Button
          variant="primary"
          pending={busy === "approve"}
          pendingLabel="Approving…"
          data-slot="item-approve"
          onClick={() => {
            if (onApprove) {
              onApprove(current);
              onOpenChange(false);
              return;
            }
            void run(
              "approve",
              async () => {
                const result = await approveItems({ itemIds: [current.id] });
                if (!result.ok) return result;
                const failed = result.data.failed[0];
                return failed ? fail(failed.code, failed.message) : result;
              },
              "Approved",
            );
          }}
        >
          Approve
        </Button>
      ) : null}
      {permissions.tick && current.rules.markDone ? (
        <Button
          variant="primary"
          pending={busy === "done"}
          pendingLabel="Marking done…"
          data-slot="item-mark-done"
          onClick={() => run("done", () => markItemDone({ itemId: current.id }), "Marked done")}
        >
          Mark done
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <ReviewSheet
        open={open && !asking}
        onOpenChange={requestClose}
        title={current.title}
        description={<StatusBadge status={ITEM_STATUS[current.state]} label={current.stateLabel} />}
        // While editing, Save is the layer's one commit (§14.1): the item's actions wait.
        actions={editing ? undefined : actions}
      >
        <div className="flex flex-col gap-4" data-slot="item-sheet">
          {editing ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {saveError ? <ErrorText slot="form-alert">{saveError}</ErrorText> : null}
              <FormField label="Title">
                {(control) => (
                  <Input
                    {...control}
                    value={title}
                    maxLength={ITEM_TITLE_MAX}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                  />
                )}
              </FormField>
              {current.rules.editAll ? (
                <FormField label="Planned date" hint="Optional. Overdue once it has passed.">
                  {(control) => (
                    <Input
                      {...control}
                      type="date"
                      value={planned}
                      onChange={(event) => setPlanned(event.target.value)}
                    />
                  )}
                </FormField>
              ) : null}
              <FormField label="Notes">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    maxLength={ITEM_NOTES_MAX}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                )}
              </FormField>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" pending={saving} pendingLabel="Saving…">
                  Save
                </Button>
              </div>
            </form>
          ) : (
            <>
              <ReviewFacts
                facts={[
                  {
                    label: "Planned",
                    value: current.planned ? (
                      <span className={cn(current.planned.overdue && "text-destructive")}>
                        {current.planned.text}
                      </span>
                    ) : (
                      "No date"
                    ),
                  },
                  ...(current.carriedFrom ? [{ label: "From", value: current.carriedFrom }] : []),
                  ...current.history.map((line, index) => ({
                    label: index === 0 ? "History" : "",
                    value: line,
                  })),
                ]}
              />
              {current.sentBack ? (
                <p
                  data-slot="item-sent-back"
                  className="border-border bg-muted/50 rounded-lg border px-3 py-2"
                >
                  Sent back by {current.sentBack.by}: {current.sentBack.reason}
                </p>
              ) : null}
              {current.closedReason ? (
                <p className="text-muted-foreground">Closed: {current.closedReason}</p>
              ) : null}
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground text-xs">Notes</p>
                <p className="break-words whitespace-pre-wrap">
                  {current.notes ?? <span className="text-muted-foreground">No notes.</span>}
                </p>
              </div>
              {permissions.manage ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={startEdit} data-slot="item-edit">
                    Edit
                  </Button>
                  {onMove && current.rules.editAll ? (
                    <>
                      <Button
                        variant="ghost"
                        aria-label="Move up"
                        onClick={() => onMove(current.id, "up")}
                      >
                        <ArrowUpIcon aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label="Move down"
                        onClick={() => onMove(current.id, "down")}
                      >
                        <ArrowDownIcon aria-hidden />
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
          {stages.length > 0 ? (
            <section aria-label="Stages" className="flex flex-col gap-1">
              <p className="text-muted-foreground text-xs">Stages</p>
              <ul className="border-border divide-border divide-y rounded-lg border">
                {stages.map((stage) => {
                  const done = ticked.has(stage.id);
                  return (
                    <li key={stage.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        disabled={!canTick || busy === stage.id}
                        data-slot="item-stage-tick"
                        onClick={() =>
                          run(
                            stage.id,
                            () => tickStage({ itemId: current.id, stageId: stage.id, done: !done }),
                            done ? `${stage.name} unticked` : `${stage.name} ticked`,
                          )
                        }
                        className="pressable-row flex min-h-11 w-full items-center gap-3 px-3 text-left disabled:opacity-70"
                      >
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded border",
                            done
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input",
                          )}
                        >
                          {done ? <CheckIcon className="size-3.5" aria-hidden /> : null}
                        </span>
                        <span className="min-w-0 flex-1 break-words">{stage.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      </ReviewSheet>
      <ConfirmDialog
        open={asking}
        onOpenChange={(next) => (next ? null : setAsking(false))}
        title="Discard your changes?"
        description="The item stays as it was."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setEditing(false);
          onOpenChange(false);
        }}
      />
      <ReasonDialog
        open={reason !== null}
        onOpenChange={(next) => (next ? null : setReason(null))}
        title={reason === "close" ? `Close ${current.title}?` : `Send back ${current.title}?`}
        description={
          reason === "close"
            ? "It stays in the cycle as closed, not done. This can't be undone."
            : "It goes back to open to fix, with your reason."
        }
        label={reason === "close" ? "Why close it" : "What needs to change"}
        submitLabel={reason === "close" ? "Close item" : "Send back"}
        onSubmit={async (text) => {
          const result =
            reason === "close"
              ? await cancelItem({ itemId: current.id, reason: text })
              : await rejectItem({ itemId: current.id, reason: text });
          const done = toastResult(result, {
            success: reason === "close" ? "Item closed" : "Sent back",
          });
          if (done) onOpenChange(false);
          return done;
        }}
      />
    </>
  );
}
