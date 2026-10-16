"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { SegmentedBar } from "@/core/ui/progress/segmented-meter";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";

import { groupStrips, nextStep, type GroupStrip } from "../domain/deliverable";
import { ITEM_STATUS } from "../domain/types";
import type { ItemStageGroupView, ItemStageView, ItemView } from "../domain/views";

import { STRIP_GRID } from "./deliverable-columns";
import { SentBackNote } from "./sent-back-note";

/** "Planned 21 Oct", "Planned 18 Oct · 2 days late" (the overdue tone), "Not planned" (muted). */
function PlannedText({ item, className }: { item: ItemView; className?: string }) {
  if (!item.planned) {
    return (
      <span
        data-slot="item-planned"
        data-planned="none"
        className={cn("text-muted-foreground", className)}
      >
        Not planned
      </span>
    );
  }
  return (
    <span
      data-slot="item-planned"
      data-planned={item.planned.overdue ? "late" : "planned"}
      data-tone={item.planned.overdue ? "danger" : undefined}
      className={cn(item.planned.overdue ? "text-danger" : "text-muted-foreground", className)}
    >
      {item.planned.text}
    </span>
  );
}

/**
 * "Next: Colour" (the first unticked stage in order); "All stages ticked" with a check when only
 * Mark done is left; "No stages" for an open one without any; a done, closed or carried
 * deliverable shows its state word instead (done with a check), never a next stage.
 */
function NextText({ item, className }: { item: ItemView; className?: string }) {
  const step = nextStep(item);
  const base = cn("flex min-w-0 items-center gap-1 text-xs break-words", className);
  if (step.kind === "stage") {
    return (
      <span data-slot="item-next" data-next="stage" className={base}>
        <span className="text-muted-foreground shrink-0">Next:</span>{" "}
        <span className="text-foreground min-w-0 font-medium">{step.name}</span>
      </span>
    );
  }
  if (step.kind === "ticked") {
    return (
      <span data-slot="item-next" data-next="ticked" className={cn(base, "text-foreground")}>
        <CheckIcon aria-hidden className="text-success size-3.5 shrink-0" />
        All stages ticked
      </span>
    );
  }
  if (step.kind === "none") {
    return (
      <span data-slot="item-next" data-next="none" className={cn(base, "text-muted-foreground")}>
        No stages
      </span>
    );
  }
  const done = step.state === "done" || step.state === "approved";
  return (
    <span data-slot="item-next" data-next="finished" className={cn(base, "text-muted-foreground")}>
      {done ? (
        <>
          <CheckIcon aria-hidden className="text-success size-3.5 shrink-0" />
          {item.stateLabel}
        </>
      ) : (
        <StatusDot
          status={ITEM_STATUS[step.state]}
          label={item.stateLabel}
          className="text-muted-foreground"
        />
      )}
    </span>
  );
}

type ChipKind = "ticked" | "next" | "later";

function chipKind(item: ItemView, stage: ItemStageView): ChipKind {
  if (stage.done) return "ticked";
  return stage.id === item.nextStageId ? "next" : "later";
}

const CHIP_WORDS: Record<ChipKind, string> = { ticked: "ticked", next: "next", later: "to do" };

/**
 * One group's stage chips, shown while its strip is open (6b.11 (3)): a ticked stage neutral and
 * filled with a check (never red, which stays for urgency), the next one outlined and emphasised,
 * the later ones muted.
 */
function StageChips({
  item,
  group,
  id,
}: {
  item: ItemView;
  group: ItemStageGroupView;
  id: string;
}) {
  return (
    <span
      id={id}
      className="flex min-w-0 flex-wrap items-center gap-1 pt-0.5 pb-1.5 pl-5.5"
      data-slot="item-row-stages"
    >
      {group.stages.map((stage) => {
        const kind = chipKind(item, stage);
        return (
          <span
            key={stage.id}
            data-slot="stage-chip"
            data-chip={kind}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs break-words",
              kind === "ticked" && "bg-neutral-soft text-foreground border-transparent",
              kind === "next" && "border-foreground/70 text-foreground font-medium",
              kind === "later" && "border-border text-muted-foreground border-dashed",
            )}
          >
            {kind === "ticked" ? <CheckIcon className="size-3 shrink-0" aria-hidden /> : null}
            {stage.name}
            <span className="sr-only">, {CHIP_WORDS[kind]}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * One stage group as a compact strip ("Edit ▮▮▮▯ 3/4"): a tap opens it in place to show the
 * group's stage chips. Opening is a **view control** (ARCHITECTURE §14.2 d): no address, no
 * history entry; back still leaves the page.
 */
function Strip({
  item,
  strip,
  group,
}: {
  item: ItemView;
  strip: GroupStrip;
  group: ItemStageGroupView;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="flex min-w-0 flex-col"
      data-slot="item-strip"
      data-open={open ? "" : undefined}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-slot="item-strip-toggle"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          STRIP_GRID,
          "pressable-row min-h-11 w-full min-w-0 rounded-md text-left text-xs lg:min-h-7",
        )}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className="text-muted-foreground min-w-0 truncate font-medium" title={strip.label}>
          {strip.label}
        </span>{" "}
        <SegmentedBar counts={strip} label={null} slot="item-strip-bar" />{" "}
        <span
          className="text-muted-foreground text-right tabular-nums"
          data-slot="item-strip-count"
        >
          {strip.done}/{strip.total}
          <span className="sr-only"> stages ticked</span>
        </span>
      </button>
      {open ? <StageChips item={item} group={group} id={id} /> : null}
    </span>
  );
}

/** The deliverable's strips, one stage group per line (the untitled group reads "Stages"). */
function Strips({ item, className }: { item: ItemView; className?: string }) {
  const strips = groupStrips(item);
  const groups = item.groups.filter((group) => group.stages.length > 0);
  if (strips.length === 0) {
    // A laptop's progress column says so; a phone's card says it in its Next line.
    return (
      <span
        data-slot="item-strips"
        data-empty=""
        className={cn(
          "text-muted-foreground hidden min-h-7 items-center text-xs lg:flex",
          className,
        )}
      >
        No stages
      </span>
    );
  }
  return (
    <span
      data-slot="item-strips"
      role="group"
      aria-label={`Stages of ${item.title}`}
      className={cn("flex min-w-0 flex-col", className)}
    >
      {strips.map((strip, index) => {
        const group = groups[index];
        return group ? <Strip key={strip.key} item={item} strip={strip} group={group} /> : null;
      })}
    </span>
  );
}

/** How Mark done looks on a row: quiet by default, outlined once every stage is ticked, solid red
 * on the one row that is the layer's commit action. */
export type MarkDoneLook = "quiet" | "ready" | "solid";

const LOOK_VARIANT = { quiet: "ghost", ready: "secondary", solid: "primary" } as const;

/**
 * One deliverable on the project page (6b.11; E+, the owner's feedback of 2026-10-16). **A laptop
 * row** reads across aligned columns: the title (a tap opens the sheet) over its "Carried from …";
 * its progress, one compact strip per stage group, each opening in place to its chips; "Next:
 * ‹stage›"; the planned date; Mark done. **A phone card**: the title over its planned date and
 * its Next line, Mark done beside it, then the strips (each a 44 px target), then the send-back
 * note. **Mark done** is quiet until every stage is ticked; then it is outlined, and the first such
 * row's is the layer's one solid red commit (`look`, `solidMarkDoneId`). The checkbox shows only
 * in Select mode, which also hides the row's own action (the bar's "Mark N done" does it).
 */
export function DeliverableRow({
  item,
  selecting,
  selectable,
  selected,
  onToggle,
  waiting,
  action,
  look,
  onOpen,
  onMarkDone,
  error,
}: {
  item: ItemView;
  /** Select mode is on: the list has a select column. */
  selecting: boolean;
  /** This row can be selected (only while selecting). */
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  /** Marked done and waiting for the server's list: faded, its action gone. */
  waiting: boolean;
  /** Mark done is offered. */
  action: boolean;
  look: MarkDoneLook;
  onOpen: () => void;
  onMarkDone: () => void;
  error: string | undefined;
}) {
  const indent = selecting ? "pl-12 lg:pl-0" : undefined;
  return (
    <li
      data-slot="item-row"
      data-state={item.state}
      data-held={waiting ? "" : undefined}
      className={cn(
        "flex flex-wrap items-start gap-x-3 px-3 py-2 transition-opacity sm:px-4",
        "lg:col-span-full lg:grid lg:grid-cols-subgrid lg:gap-y-1",
        waiting && "opacity-50",
      )}
    >
      {selecting ? (
        selectable ? (
          // A 44 px target around the box (§14.1).
          <label className="-ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center lg:ml-0 lg:h-7">
            <Checkbox
              aria-label={`Select ${item.title}`}
              checked={selected}
              disabled={waiting}
              onCheckedChange={onToggle}
            />
          </label>
        ) : (
          <span aria-hidden className="-ml-2 size-11 shrink-0 lg:ml-0 lg:h-7" />
        )
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        data-slot="item-open"
        className="pressable-row flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center gap-0.5 py-0.5 text-left lg:min-h-7 lg:py-1"
      >
        <span
          className={cn(
            "text-sm font-medium break-words",
            (item.state === "cancelled" || item.state === "carried") &&
              "text-muted-foreground line-through",
          )}
        >
          {item.title}
        </span>
        <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs lg:hidden">
          <PlannedText item={item} />
          {item.carriedFrom ? <span>{item.carriedFrom}</span> : null}
        </span>
        {item.carriedFrom ? (
          <span className="text-muted-foreground hidden text-xs lg:block">{item.carriedFrom}</span>
        ) : null}
        <NextText item={item} className="lg:hidden" />
      </button>
      <Strips item={item} className={cn("order-last basis-full lg:order-none", indent)} />
      <span data-slot="item-next-cell" className="hidden min-h-7 items-center lg:flex">
        {nextStep(item).kind === "none" ? null : <NextText item={item} />}
      </span>
      <span data-slot="item-planned-cell" className="hidden min-h-7 items-center text-xs lg:flex">
        <PlannedText item={item} />
      </span>
      <span
        data-slot="item-action"
        className="ml-auto flex min-h-11 shrink-0 items-center justify-end lg:ml-0 lg:min-h-7"
      >
        {action && !selecting ? (
          <Button
            variant={LOOK_VARIANT[look]}
            size="sm"
            disabled={waiting}
            data-slot="item-row-done"
            data-look={look}
            onClick={onMarkDone}
          >
            <CheckIcon aria-hidden />
            Mark done
          </Button>
        ) : null}
      </span>
      {item.sentBack ? (
        <SentBackNote
          slot="item-row-sent-back"
          text={item.sentBack.text}
          className={cn(
            "order-last basis-full pb-1 lg:order-none",
            selecting ? "pl-12 lg:col-[2/-1] lg:pl-0" : "lg:col-span-full",
          )}
        />
      ) : null}
      {error ? (
        <ErrorText className="order-last basis-full lg:order-none lg:col-span-full">
          {error}
        </ErrorText>
      ) : null}
    </li>
  );
}
