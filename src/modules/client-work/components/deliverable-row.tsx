"use client";

import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { ProgressBar } from "@/core/ui/progress/segmented-meter";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { AfterPage } from "@/core/ui/lazy/after-page";
import { menuStandInPress } from "@/core/ui/lazy/menu-stand-in";

import { groupStrips, markDonePlace, nextStep, type GroupStrip } from "../domain/deliverable";
import { ITEM_STATUS } from "../domain/types";
import type { ItemStageGroupView, ItemStageView, ItemView } from "../domain/views";

import { STRIP_GRID } from "./deliverable-columns";
import type { ItemRowMenuProps } from "./item-row-menu";
import { ItemRowMenuTrigger } from "./item-row-menu-trigger";
import { SentBackNote } from "./sent-back-note";

/** Above the row's stretched open target (`ROW_OPEN`): the row's own controls keep their taps. */
const OVER_ROW = "relative z-10";

/**
 * The whole row opens the deliverable (unit U, the owner's note of 2026-10-16): the title is the
 * real button and its `::after` covers the row, so a tap or click anywhere that is not one of the
 * row's own controls opens it, and Tab, Enter and Space reach it as one button (no control nested
 * in another; the pattern of Settings' rows). Its focus ring is drawn around the whole row.
 */
const ROW_OPEN =
  "outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset";

const loadRowMenu = () => import("./item-row-menu").then((module) => module.ItemRowMenu);

/**
 * The row's ⋯ menu (Open, Mark done), **loaded after the page** (ARCHITECTURE §19): the Radix
 * menu draws nothing until it is opened, so it stays out of the project page's first-load
 * JavaScript. Until it arrives the same button stands in; a tap on it opens the menu as soon as
 * the code is there (`menuStandInPress`, the pattern of `UserMenu` and `ThemeToggle`).
 */
function RowMenu(props: Omit<ItemRowMenuProps, "defaultOpen">) {
  const [wanted, setWanted] = useState(false);
  return (
    <AfterPage
      load={loadRowMenu}
      props={{ ...props, defaultOpen: wanted }}
      fallback={
        <ItemRowMenuTrigger
          title={props.title}
          disabled={props.disabled}
          className={props.className}
          aria-haspopup="menu"
          aria-expanded={false}
          data-state="closed"
          {...menuStandInPress(() => setWanted(true))}
        />
      }
    />
  );
}

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

/** What a tick on the row needs: who may tick, which stage is on its way, and the tick itself. */
export type RowTicks = {
  /** The viewer may tick this deliverable's stages now (`items.tick`, open, not held). */
  can: boolean;
  /** The stage whose tick or untick is on its way (its control waits). */
  pending: string | null;
  tick: (stage: ItemStageView, done: boolean) => void;
};

/**
 * "Next: Colour" (the first unticked stage in order); "All stages ticked" with a check when only
 * Mark done is left; "No stages" for an open one without any; a done, closed or carried
 * deliverable shows its state word instead (done with a check), never a next stage. For whoever
 * may tick, "Next: ‹stage›" is a one-tap tick of that stage ("Tick Colour", unit U).
 */
function NextText({
  item,
  ticks,
  className,
}: {
  item: ItemView;
  ticks: RowTicks;
  className?: string;
}) {
  const step = nextStep(item);
  const base = cn("flex min-w-0 items-center gap-1 text-xs break-words", className);
  if (step.kind === "stage") {
    const stage = item.stages.find((candidate) => candidate.id === item.nextStageId);
    const words = (
      <>
        <span className="text-muted-foreground shrink-0">Next:</span>{" "}
        <span className="text-foreground min-w-0 font-medium">{step.name}</span>
      </>
    );
    if (ticks.can && stage) {
      return (
        <button
          type="button"
          data-slot="item-next"
          data-next="stage"
          aria-label={`Tick ${step.name}`}
          title={`Tick ${step.name}`}
          disabled={ticks.pending !== null}
          aria-busy={ticks.pending === stage.id || undefined}
          onClick={() => ticks.tick(stage, true)}
          className={cn(
            base,
            OVER_ROW,
            "pressable group/next focus-visible:ring-ring -mx-1 rounded-md px-1 text-left hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-70",
          )}
        >
          <CircleIcon
            aria-hidden
            className="text-muted-foreground group-hover/next:text-foreground size-3.5 shrink-0"
          />
          {words}
        </button>
      );
    }
    return (
      <span data-slot="item-next" data-next="stage" className={base}>
        {words}
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

const CHIP_LOOK: Record<ChipKind, string> = {
  ticked: "bg-neutral-soft text-foreground border-transparent",
  next: "border-foreground/70 text-foreground font-medium",
  later: "border-border text-muted-foreground border-dashed",
};

/**
 * One group's stage chips, shown while its strip is open (6b.11 (3)): a ticked stage neutral and
 * filled with a check (never red, which stays for urgency), the next one outlined and emphasised,
 * the later ones muted. For whoever may tick, each chip ticks or unticks its stage in one tap
 * ("Tick Cut", "Untick Cut"; unit U), with a 44 px target on a phone; otherwise they only read.
 */
function StageChips({
  item,
  group,
  id,
  ticks,
}: {
  item: ItemView;
  group: ItemStageGroupView;
  id: string;
  ticks: RowTicks;
}) {
  return (
    <span
      id={id}
      className={cn(
        "flex min-w-0 flex-wrap items-center pt-0.5 pb-1.5 pl-5.5",
        ticks.can ? "gap-2 lg:gap-1" : "gap-1",
      )}
      data-slot="item-row-stages"
    >
      {group.stages.map((stage) => {
        const kind = chipKind(item, stage);
        const look = cn(
          "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs break-words",
          CHIP_LOOK[kind],
        );
        const inside = (
          <>
            {kind === "ticked" ? <CheckIcon className="size-3 shrink-0" aria-hidden /> : null}
            {stage.name}
            <span className="sr-only">, {CHIP_WORDS[kind]}</span>
          </>
        );
        if (!ticks.can) {
          return (
            <span key={stage.id} data-slot="stage-chip" data-chip={kind} className={look}>
              {inside}
            </span>
          );
        }
        const verb = stage.done ? "Untick" : "Tick";
        return (
          <button
            key={stage.id}
            type="button"
            data-slot="stage-chip"
            data-chip={kind}
            aria-label={`${verb} ${stage.name}`}
            title={`${verb} ${stage.name}`}
            disabled={ticks.pending !== null}
            aria-busy={ticks.pending === stage.id || undefined}
            onClick={() => ticks.tick(stage, !stage.done)}
            className={cn(
              look,
              OVER_ROW,
              // A 36 px chip with a 44 px target on a phone (the rows wrap 44 px apart).
              "pressable hover:border-foreground/70 focus-visible:ring-ring min-h-9 px-3 after:absolute after:inset-x-0 after:-inset-y-1 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-70 lg:min-h-6 lg:px-2 lg:after:hidden",
            )}
          >
            {inside}
          </button>
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
  ticks,
}: {
  item: ItemView;
  strip: GroupStrip;
  group: ItemStageGroupView;
  ticks: RowTicks;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const verb = open ? "Hide" : "Show";
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
        title={`${verb} ${strip.label}'s stages`}
        data-slot="item-strip-toggle"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          STRIP_GRID,
          OVER_ROW,
          "pressable-row hover:bg-muted focus-visible:ring-ring min-h-11 w-full min-w-0 rounded-md text-left text-xs focus-visible:ring-2 focus-visible:outline-none lg:min-h-7",
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
        <ProgressBar counts={strip} label={null} slot="item-strip-bar" />{" "}
        <span
          className="text-muted-foreground text-right tabular-nums"
          data-slot="item-strip-count"
        >
          {strip.done}/{strip.total}
          <span className="sr-only"> stages ticked</span>
        </span>
      </button>
      {open ? <StageChips item={item} group={group} id={id} ticks={ticks} /> : null}
    </span>
  );
}

/** The deliverable's strips, one stage group per line (the untitled group reads "Stages"). */
function Strips({
  item,
  ticks,
  className,
}: {
  item: ItemView;
  ticks: RowTicks;
  className?: string;
}) {
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
        return group ? (
          <Strip key={strip.key} item={item} strip={strip} group={group} ticks={ticks} />
        ) : null;
      })}
    </span>
  );
}

/** How Mark done looks on a row: quiet for a deliverable without stages, outlined once every
 * stage is ticked, solid red on the one row that is the layer's commit action. */
export type MarkDoneLook = "quiet" | "ready" | "solid";

const LOOK_VARIANT = { quiet: "ghost", ready: "secondary", solid: "primary" } as const;

/**
 * One deliverable on the project page (6b.11; E+ and U, the owner's feedback of 2026-10-16). **A
 * tap anywhere on the row opens its sheet** (the title is the button, stretched over the row; a
 * "›" at its right edge says so), except on its own controls: the strips (each opens in place to
 * its chips, which tick or untick in one tap), "Next: ‹stage›" (ticks it), Mark done and ⋯. **A
 * laptop row** reads across aligned columns: the title over its "Carried from …"; one strip per
 * stage group; "Next: ‹stage›"; the planned date; Mark done or ⋯. **A phone card**: the title over
 * its planned date and its Next line, Mark done or ⋯ beside it, then the strips (each a 44 px
 * target), then the send-back note. **Mark done** shows on the row once every stage is ticked
 * (outlined; the first such row's is the layer's one solid red commit) or when there are no stages
 * (quiet); until then it is in the row's ⋯ with Open. **In Select mode** a tap on the row ticks
 * its checkbox instead (the checkbox's label is stretched over the row), and the row's own Mark
 * done and ⋯ step aside (the bar does it).
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
  ticks,
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
  /** Mark done is offered (the viewer may, the deliverable is open). */
  action: boolean;
  look: MarkDoneLook;
  ticks: RowTicks;
  onOpen: () => void;
  onMarkDone: () => void;
  error: string | undefined;
}) {
  const indent = selecting ? "pl-12 lg:pl-0" : undefined;
  // In Select mode a selectable row's tap is its checkbox's; any other row's opens it.
  const selectsOnTap = selecting && selectable;
  const place = markDonePlace(item, action, selecting);
  const title = (
    <span
      className={cn(
        "text-sm font-medium break-words",
        (item.state === "cancelled" || item.state === "carried") &&
          "text-muted-foreground line-through",
      )}
    >
      {item.title}
    </span>
  );
  const facts = (
    <>
      {title}
      <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs lg:hidden">
        <PlannedText item={item} />
        {item.carriedFrom ? <span>{item.carriedFrom}</span> : null}
      </span>
      {item.carriedFrom ? (
        <span className="text-muted-foreground hidden text-xs lg:block">{item.carriedFrom}</span>
      ) : null}
    </>
  );
  const factsLook = "flex min-h-6 min-w-0 flex-col justify-center gap-0.5 py-0.5 text-left lg:py-1";
  return (
    <li
      data-slot="item-row"
      data-state={item.state}
      data-held={waiting ? "" : undefined}
      className={cn(
        "relative flex flex-wrap items-start gap-x-3 px-3 py-2 transition-[opacity,background-color] sm:px-4",
        "hover:bg-muted/50 has-[[data-slot=item-open]:active]:bg-muted",
        "lg:col-span-full lg:grid lg:grid-cols-subgrid lg:gap-y-1",
        waiting && "opacity-50",
      )}
    >
      {selecting ? (
        selectable ? (
          // A 44 px target around the box (§14.1), and the row's tap while selecting.
          <label
            data-slot="item-select"
            className="-ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center after:absolute after:inset-0 lg:ml-0 lg:h-7"
          >
            <Checkbox
              aria-label={`Select ${item.title}`}
              checked={selected}
              disabled={waiting}
              onCheckedChange={onToggle}
              className="z-10"
            />
          </label>
        ) : (
          <span aria-hidden className="-ml-2 size-11 shrink-0 lg:ml-0 lg:h-7" />
        )
      ) : null}
      <span className="flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center lg:min-h-7">
        {selectsOnTap ? (
          <span data-slot="item-open" className={factsLook}>
            {facts}
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            data-slot="item-open"
            title={`Open ${item.title}`}
            className={cn(factsLook, ROW_OPEN, "pressable-row")}
          >
            {facts}
          </button>
        )}
        {/* A phone's Next line: a 44 px line, a tap target when it ticks. */}
        <span className="flex min-h-11 min-w-0 items-center lg:hidden" data-slot="item-next-line">
          <NextText item={item} ticks={ticks} />
        </span>
      </span>
      <Strips
        item={item}
        ticks={ticks}
        className={cn("order-last basis-full lg:order-none", indent)}
      />
      <span data-slot="item-next-cell" className="hidden min-h-7 items-center lg:flex">
        {nextStep(item).kind === "none" ? null : <NextText item={item} ticks={ticks} />}
      </span>
      <span data-slot="item-planned-cell" className="hidden min-h-7 items-center text-xs lg:flex">
        <PlannedText item={item} />
      </span>
      <span
        data-slot="item-action"
        className="ml-auto flex min-h-11 shrink-0 items-center justify-end gap-1 lg:ml-0 lg:min-h-7"
      >
        {place === "row" ? (
          <Button
            variant={LOOK_VARIANT[look]}
            size="sm"
            disabled={waiting}
            data-slot="item-row-done"
            data-look={look}
            title={`Mark ${item.title} done`}
            onClick={onMarkDone}
            className={OVER_ROW}
          >
            <CheckIcon aria-hidden />
            Mark done
          </Button>
        ) : null}
        {place === "menu" ? (
          <RowMenu
            title={item.title}
            disabled={waiting}
            className={OVER_ROW}
            onOpen={onOpen}
            onMarkDone={onMarkDone}
          />
        ) : null}
        {selectsOnTap ? null : (
          <ChevronRightIcon
            aria-hidden
            data-slot="item-row-chevron"
            className="text-muted-foreground size-4 shrink-0"
          />
        )}
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
