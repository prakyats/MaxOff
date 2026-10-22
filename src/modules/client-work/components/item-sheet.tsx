"use client";

import { ArrowDownIcon, ArrowUpIcon, CheckIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { Result } from "@/core/errors/result";
import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { ErrorText } from "@/core/ui/composites/error-text";
import { FormField } from "@/core/ui/composites/form-field";
import { HistoryButton } from "@/core/ui/composites/history-button";
import { OverlayLink } from "@/core/ui/composites/overlay-link";
import { ReasonDialog } from "@/core/ui/composites/reason-dialog";
import { ReviewFacts, ReviewSheet } from "@/core/ui/composites/review-sheet";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { Input } from "@/core/ui/primitives/input";
import { DateInput } from "@/core/ui/primitives/date-time-input";
import { Textarea } from "@/core/ui/primitives/textarea";
import { closeOverlaysThen, useOverlayHistory } from "@/core/ui/overlay/overlay-history";
import { describeError, toastResult } from "@/core/ui/toast";

import {
  addItemStage,
  addItemStageGroup,
  archiveItemStage,
  archiveItemStageGroup,
  cancelItem,
  markItemDone,
  reopenItem,
  updateItem,
  updateItemStage,
  updateItemStageGroup,
} from "../actions/items";
import { addRevisionRound } from "../actions/bulk";
import { saveItemAsTemplate } from "../actions/templates";
import { groupStrips, lastChangeLine, untickedWords } from "../domain/deliverable";
import { ITEM_NOTES_MAX, ITEM_TITLE_MAX } from "../domain/schemas";
import { ITEM_STATUS } from "../domain/types";
import type { ItemView } from "../domain/views";

import { SentBackNote } from "./sent-back-note";
import { tickWithUndo } from "./tick-with-undo";

import type { StagePresetOption } from "@/core/ui/stage-groups/editing";

/** A deliverable's stage editor, on the first tap of "Edit stages" (ARCHITECTURE §19). */
const GroupedStagesSheet = dynamic(
  () => import("./grouped-stages-sheet").then((module) => module.GroupedStagesSheet),
  { ssr: false },
);

/** One item's history, on the first tap of "History" (ARCHITECTURE §19). */
/** "Save as template" (6b Release 2), on its first pick. */
const SaveAsTemplateDialog = dynamic(
  () => import("./save-as-template-dialog").then((module) => module.SaveAsTemplateDialog),
  { ssr: false },
);

const ActivityPanel = dynamic(
  () => import("./activity-panel").then((module) => module.ActivityPanel),
  { ssr: false },
);

/** What the viewer may do on the screen that opened the sheet (their keys, the project's state). */
export type ItemPermissions = {
  /** `projects.manage` on a project that is open or in progress: details and the item's stages. */
  manage: boolean;
  /** `items.tick` on a project that is open or in progress: ticks and Mark done (= approved). */
  tick: boolean;
  /**
   * `items.approve` on a project that is open or in progress: since amendment D3, send back (the
   * Owner) or reopen (the client's Admin) a done item with a reason.
   */
  reopen: boolean;
  /** The viewer is the Owner: his reopen is a "Send back". */
  owner: boolean;
};

/**
 * An item's sheet (7.3; PRODUCT §4.5, WORKFLOWS §5.3, kickoff 7 decisions 7, 12; Q5 (b); amendment
 * D): its state, planned date, notes, "Last change … · History" and its **own stages** (44 px
 * ticks; "Edit stages" adds, renames, moves and removes them on this item only), and the actions
 * the viewer may take: **Mark done** (`items.tick`; it is approved in the same step, D3), **Send
 * back…** (the Owner) or **Reopen…** (the client's Admin) a done item with a reason
 * (`items.approve`), Edit, Move and Close with a reason (`projects.manage`; once done, closed or
 * carried only the title and notes change). A bottom sheet on a phone (`ReviewSheet`): back closes
 * it, and a layer opened from it (the reason, the stage editor, the history) closes first (§14.2
 * a). **Edit is a layer of its own** (§14.2 f, as `EditableRecord`; owner's walk 2026-10-09):
 * back or Cancel returns to the item's facts, and a second back closes the sheet; with an edit
 * typed and not saved, either asks "Discard your changes?" first over the sheet, and back on that
 * keeps editing. Closing the sheet itself (✕, the backdrop) with an edit typed asks the same and
 * then closes it. **The sheet always opens on the facts**: an edit left open ends with the sheet.
 * **Mark done** goes through `onMarkDone` where the screen gives it (the 6-second Undo) and the
 * sheet closes.
 */
export function ItemSheet({
  item,
  permissions,
  open,
  onOpenChange,
  projectHref,
  onMove,
  canMove,
  onMarkDone,
  presets = [],
}: {
  /** Whether the item can move that way (not already first or last); without it, both can. */
  canMove?: ((itemId: string, direction: "up" | "down") => boolean) | undefined;
  /** The stage presets ("Add from a preset" in Edit stages adds one as a group, 6b). */
  presets?: readonly StagePresetOption[];
  item: ItemView | null;
  permissions: ItemPermissions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened from outside the project (Today, the lists): a way to the project's page. */
  projectHref?: string;
  /** Opened on the project page: move the item up or down its list. */
  onMove?: ((itemId: string, direction: "up" | "down") => void) | undefined;
  /** The screen's Mark done with Undo; without it the sheet marks it done at once. */
  onMarkDone?: ((item: ItemView) => void) | undefined;
}) {
  // Editing belongs to the item it started on: another item, or a reopened sheet, shows its facts.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [planned, setPlanned] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // A stage's tick on its way (its box waits; the toast offers Undo).
  const [ticking, setTicking] = useState<string | null>(null);
  const [reason, setReason] = useState<"reopen" | "close" | null>(null);
  // "Mark done…" from ⋯ before every stage is ticked (PP-sheet-2): its confirmation.
  const [early, setEarly] = useState(false);
  // "Save as template" from the ⋯ (6b Release 2): the item it was opened for.
  const [templateFor, setTemplateFor] = useState<{ id: string; title: string } | null>(null);
  // "Discard your changes?" (§14.2 f): over the sheet when leaving the edit ("edit": back or
  // Cancel, then the facts), or standing in for the sheet when it is being closed ("close").
  const [discard, setDiscard] = useState<"edit" | "close" | null>(null);
  // Set while a way out of the edit backs its history entry out, so the layers closing on the
  // way (the edit's own, the confirmation's) do not act on it.
  const leaving = useRef(false);
  // The sheet always opens on the item's facts: an edit left open ends with the sheet.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEditingId(null);
      setDiscard(null);
    }
  }
  const [editingStages, setEditingStages] = useState(false);
  // The stage editor's code arrives on its first open and stays (ARCHITECTURE §19).
  const [stagesUsed, setStagesUsed] = useState(false);
  // The item's history: mounted afresh on each opening (its key), kept for its closing animation.
  const [history, setHistory] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const editing = open && item !== null && editingId === item.id;
  const dirty =
    editing &&
    item !== null &&
    (title !== item.title ||
      notes !== (item.notes ?? "") ||
      (item.rules.editAll && planned !== (item.plannedDate ?? "")));

  // The edit is a history layer over the sheet (§14.2 f): back leaves it for the facts, or asks
  // first when something was typed.
  useOverlayHistory(editing && discard === null, () => {
    if (leaving.current) return;
    if (dirty) {
      setDiscard("edit");
    } else {
      setEditingId(null);
      setSaveError(null);
    }
  });

  /** Back to the facts, backing the edit's (or the confirmation's) history entry out. */
  function leaveEdit() {
    leaving.current = true;
    const done = () => {
      leaving.current = false;
      setEditingId(null);
      setDiscard(null);
      setSaveError(null);
    };
    if (!closeOverlaysThen(done)) done();
  }

  if (!item) {
    return (
      <ReviewSheet open={false} onOpenChange={onOpenChange} title="">
        {null}
      </ReviewSheet>
    );
  }
  const current = item;

  function requestClose(next: boolean) {
    if (!next && dirty && !saving) {
      setDiscard("close");
      return;
    }
    onOpenChange(next);
  }

  function cancelEdit() {
    if (dirty) setDiscard("edit");
    else leaveEdit();
  }

  function startEdit() {
    setTitle(current.title);
    setNotes(current.notes ?? "");
    setPlanned(current.plannedDate ?? "");
    setSaveError(null);
    setEditingId(current.id);
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
    leaveEdit();
  }

  async function run(key: string, send: () => Promise<Result<unknown>>, success: string) {
    setBusy(key);
    toastResult(await send(), { success });
    setBusy(null);
  }

  async function addRound(itemId: string) {
    const result = await addRevisionRound({ itemId });
    if (result.ok) toast.success(`Added ${result.data.name}`);
    else toastResult(result);
  }

  const canTick = permissions.tick && current.rules.ticks;
  // Each group with the list's strip words and count (unit U): "Edit 2/3", "Stages 1/1".
  const strips = groupStrips(current);
  const stageGroups = current.groups
    .filter((group) => group.stages.length > 0)
    .flatMap((group, index) => {
      const strip = strips[index];
      return strip ? [{ strip, group }] : [];
    });
  const canEditStages = permissions.manage && current.rules.editAll;
  const reopenWord = permissions.owner ? "Send back" : "Reopen";
  // PP-sheet-2: until every stage is ticked the sheet's action is "Next: ‹stage›" (it ticks that
  // stage); Mark done is the solid Forest commit only once it is ready (or has no stages), and
  // before that it waits in ⋯ behind a confirmation that names what is left unticked.
  const markDone = permissions.tick && current.rules.markDone;
  const unticked = current.stages.filter((stage) => !stage.done).length;
  const nextStage =
    markDone && canTick && unticked > 0
      ? (current.stages.find((stage) => stage.id === current.nextStageId) ??
        current.stages.find((stage) => !stage.done) ??
        null)
      : null;
  const earlyDone = markDone && unticked > 0;
  function markItDone() {
    if (onMarkDone) {
      onMarkDone(current);
      onOpenChange(false);
      return;
    }
    void run("done", () => markItemDone({ itemId: current.id }), "Marked done");
  }
  const actions = (
    <>
      {projectHref ? (
        <Button variant="ghost" asChild>
          <OverlayLink href={projectHref}>Open the project</OverlayLink>
        </Button>
      ) : null}
      {permissions.manage && current.rules.cancel ? (
        // PP-sheet-3: the way to close it reads red (its confirm's dismiss is "Keep it").
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => setReason("close")}
          data-slot="item-close"
        >
          Close deliverable…
        </Button>
      ) : null}
      {permissions.reopen && current.rules.reopen ? (
        <Button variant="secondary" onClick={() => setReason("reopen")} data-slot="item-reopen">
          {reopenWord}…
        </Button>
      ) : null}
      {nextStage ? (
        <Button
          variant="primary"
          pending={ticking === nextStage.id}
          pendingLabel="Ticking…"
          disabled={ticking !== null}
          data-slot="item-next-stage"
          onClick={() =>
            void tickWithUndo(nextStage, true, current.title, setTicking, { undo: false })
          }
        >
          <span className="min-w-0 break-words">Next: {nextStage.name}</span>
        </Button>
      ) : markDone && !earlyDone ? (
        <Button
          variant="approve"
          pending={busy === "done"}
          pendingLabel="Marking done…"
          data-slot="item-mark-done"
          onClick={markItDone}
        >
          Mark done
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <ReviewSheet
        open={open && discard !== "close"}
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
                    <DateInput
                      {...control}
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
                <Button type="button" variant="secondary" onClick={cancelEdit} data-dismiss="">
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
              {/* One row: the short line wraps on its own, the History clock (44 px) stays at its
                  end (PP-sheet-1: the clock, as every History in the app). */}
              <div
                data-slot="item-last-change"
                className="text-muted-foreground flex items-center justify-between gap-2"
              >
                <p className="min-w-0 flex-1 break-words">
                  {current.lastChange
                    ? lastChangeLine(current.lastChange, current.title)
                    : "No changes recorded yet."}
                </p>
                <span className="flex shrink-0">
                  <HistoryButton
                    onOpen={() => {
                      setHistory((count) => count + 1);
                      setHistoryOpen(true);
                    }}
                  />
                </span>
              </div>
              {current.sentBack ? (
                <SentBackNote
                  slot="item-sent-back"
                  text={current.sentBack.text}
                  className="border-border bg-muted/50 rounded-lg border px-3 py-2 text-sm"
                />
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
              {permissions.manage || earlyDone ? (
                <div className="flex flex-wrap gap-2">
                  {permissions.manage ? (
                    <Button variant="secondary" onClick={startEdit} data-slot="item-edit">
                      Edit details
                    </Button>
                  ) : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`More for ${current.title}`}
                        title="More actions"
                        data-slot="item-more"
                      >
                        <MoreHorizontalIcon aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" title={current.title}>
                      {earlyDone ? (
                        <DropdownMenuItem
                          data-slot="item-mark-done-early"
                          onSelect={() => setEarly(true)}
                        >
                          <CheckIcon aria-hidden />
                          Mark done…
                        </DropdownMenuItem>
                      ) : null}
                      {permissions.manage && current.state === "open" ? (
                        // 6b.16 (c): one more revision stage, named after its own ("Revision 3").
                        <DropdownMenuItem
                          data-slot="item-revision-round"
                          onSelect={() => void addRound(current.id)}
                        >
                          <PlusIcon aria-hidden />
                          Another revision round
                        </DropdownMenuItem>
                      ) : null}
                      {permissions.manage && onMove && current.rules.editAll ? (
                        // Unit U: named menu items, not bare arrows (the list's order).
                        <>
                          <DropdownMenuItem
                            data-slot="item-move-up"
                            disabled={canMove ? !canMove(current.id, "up") : false}
                            onSelect={() => onMove(current.id, "up")}
                          >
                            <ArrowUpIcon aria-hidden />
                            Move up
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            data-slot="item-move-down"
                            disabled={canMove ? !canMove(current.id, "down") : false}
                            onSelect={() => onMove(current.id, "down")}
                          >
                            <ArrowDownIcon aria-hidden />
                            Move down
                          </DropdownMenuItem>
                        </>
                      ) : null}
                      {permissions.manage ? (
                        <DropdownMenuItem
                          onSelect={() => setTemplateFor({ id: current.id, title: current.title })}
                        >
                          Save as template
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </>
          )}
          {current.stages.length > 0 || canEditStages ? (
            <section aria-label="Stages" className="flex flex-col gap-1" data-slot="item-stages">
              <div className="flex min-h-11 items-center justify-between gap-2">
                {/* The untitled group's own heading reads "Stages" right under it. */}
                <p
                  className={cn(
                    "text-muted-foreground text-xs",
                    stageGroups[0]?.group.label === null && "sr-only",
                  )}
                >
                  Stages
                </p>
                {canEditStages && !editing ? (
                  <Button
                    variant="ghost"
                    className="ml-auto"
                    data-slot="item-stages-edit"
                    onClick={() => {
                      setStagesUsed(true);
                      setEditingStages(true);
                    }}
                  >
                    Edit stages
                  </Button>
                ) : null}
              </div>
              {current.stages.length === 0 ? (
                <p className="text-muted-foreground">
                  No stages: this deliverable is simply open or done.
                </p>
              ) : (
                stageGroups.map(({ strip, group }) => (
                  <div key={strip.key} className="flex flex-col gap-1" data-slot="item-stage-group">
                    {/* The list's own heading and "n/m" for each group (unit U, `groupStrips`):
                        the untitled group reads "Stages". */}
                    <p
                      className="text-muted-foreground flex items-baseline justify-between gap-2 pt-1 text-xs font-medium"
                      data-slot="item-stage-group-heading"
                    >
                      <span className="min-w-0 break-words">{strip.label}</span>
                      <span className="tabular-nums">
                        {strip.done}/{strip.total}
                        <span className="sr-only"> stages ticked</span>
                      </span>
                    </p>
                    <ul className="border-border divide-border divide-y rounded-lg border">
                      {group.stages.map((stage) => (
                        <li key={stage.id}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={stage.done}
                            disabled={!canTick || ticking !== null}
                            aria-busy={ticking === stage.id || undefined}
                            title={
                              canTick
                                ? `${stage.done ? "Untick" : "Tick"} ${stage.name}`
                                : undefined
                            }
                            data-slot="item-stage-tick"
                            onClick={() =>
                              void tickWithUndo(stage, !stage.done, current.title, setTicking, {
                                undo: false,
                              })
                            }
                            className="pressable-row hover:bg-muted/50 flex min-h-11 w-full items-center gap-3 px-3 text-left disabled:opacity-70"
                          >
                            {/* Ticked is neutral (the checkbox's own look), never red: red stays
                                for the sheet's one commit, Mark done (unit U). */}
                            <span
                              data-slot="item-stage-box"
                              className={cn(
                                "flex size-5 shrink-0 items-center justify-center rounded border",
                                stage.done
                                  ? "border-strong bg-strong text-strong-foreground"
                                  : "border-input",
                              )}
                            >
                              {stage.done ? <CheckIcon className="size-3.5" aria-hidden /> : null}
                            </span>
                            <span className="min-w-0 flex-1 break-words">{stage.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>
          ) : null}
        </div>
      </ReviewSheet>
      <ConfirmDialog
        destructive
        open={discard !== null}
        onOpenChange={(next) => {
          // Keep editing (its button or back): the edit, and the sheet, as they were.
          if (!next && !leaving.current) setDiscard(null);
        }}
        title="Discard your changes?"
        description="The deliverable stays as it was."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          if (discard === "close") {
            setEditingId(null);
            setDiscard(null);
            onOpenChange(false);
            return;
          }
          leaveEdit();
        }}
      />
      <ConfirmDialog
        approve
        open={early}
        onOpenChange={setEarly}
        title={`Mark ${current.title} done?`}
        description={`${untickedWords(unticked)} Mark done counts every stage as delivered.`}
        confirmLabel="Mark done"
        cancelLabel="Keep it open"
        onConfirm={() => {
          setEarly(false);
          markItDone();
        }}
      />
      <ReasonDialog
        open={reason !== null}
        onOpenChange={(next) => (next ? null : setReason(null))}
        title={reason === "close" ? `Close ${current.title}?` : `${reopenWord} ${current.title}?`}
        description={
          reason === "close"
            ? "It stays in the cycle as closed, not done. This can't be undone."
            : "It goes back to open and stops counting as done until it is done again."
        }
        label={reason === "close" ? "Why close it" : "What needs to change"}
        submitLabel={reason === "close" ? "Close deliverable" : reopenWord}
        destructive={reason === "close"}
        onSubmit={async (text) => {
          const result =
            reason === "close"
              ? await cancelItem({ itemId: current.id, reason: text })
              : await reopenItem({ itemId: current.id, reason: text });
          const done = toastResult(result, {
            success:
              reason === "close"
                ? "Deliverable closed"
                : permissions.owner
                  ? "Sent back"
                  : "Reopened",
          });
          if (done) onOpenChange(false);
          return done;
        }}
      />
      {canEditStages && stagesUsed ? (
        <GroupedStagesSheet
          open={editingStages}
          onOpenChange={setEditingStages}
          title={`Stages of ${current.title}`}
          description="This deliverable only. The project's default stages and its other deliverables stay as they are. Ticks stay as they are."
          removeStageDescription="It leaves this deliverable; its tick stays in the history."
          removeGroupDescription="Its stages leave this deliverable; their ticks stay in the history."
          rows={current.stages}
          presets={presets}
          ops={{
            addStage: (name, groupLabel) => addItemStage({ itemId: current.id, name, groupLabel }),
            renameStage: (stageId, name) => updateItemStage({ stageId, name }),
            moveStage: (stageId, position) => updateItemStage({ stageId, position }),
            removeStage: (stageId) => archiveItemStage({ stageId }),
            addGroup: (label, names) =>
              addItemStageGroup({ itemId: current.id, label, stages: names }),
            renameGroup: (label, newLabel) =>
              updateItemStageGroup({ itemId: current.id, label, newLabel }),
            moveGroup: (label, position) =>
              updateItemStageGroup({ itemId: current.id, label, position }),
            removeGroup: (label) => archiveItemStageGroup({ itemId: current.id, label }),
          }}
        />
      ) : null}
      {templateFor !== null ? (
        <SaveAsTemplateDialog
          open
          onOpenChange={(next) => (next ? null : setTemplateFor(null))}
          what="deliverable"
          initialName={templateFor.title}
          save={(name) => saveItemAsTemplate({ itemId: templateFor.id, name })}
        />
      ) : null}
      {history > 0 ? (
        <ActivityPanel
          key={history}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          projectId={current.projectId}
          item={{ id: current.id, title: current.title }}
        />
      ) : null}
    </>
  );
}
