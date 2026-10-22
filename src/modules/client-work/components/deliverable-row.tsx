"use client";

import { CheckIcon, ChevronRightIcon, CircleIcon, LightbulbIcon } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { ProgressBar } from "@/core/ui/progress/segmented-meter";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";
import { AfterPage } from "@/core/ui/lazy/after-page";
import { menuStandInPress } from "@/core/ui/lazy/menu-stand-in";

import {
  groupStrips,
  groupsLine,
  itemProgress,
  markDonePlace,
  nextStep,
  progressShape,
  suggestsGrouping,
  typesNumberedRounds,
  UNTITLED_GROUP_LABEL,
} from "../domain/deliverable";
import { ITEM_STATUS } from "../domain/types";
import type { ItemStageGroupView, ItemStageView, ItemView } from "../domain/views";

import { PROGRESS_GRID } from "./deliverable-columns";
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
function PlannedText({
  item,
  className,
  short = false,
}: {
  item: ItemView;
  className?: string;
  /** The laptop's Planned column: "15 Oct · 1 day late", without the word "Planned". */
  short?: boolean;
}) {
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
      {short ? item.planned.text.replace(/^Planned /, "") : item.planned.text}
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
  chip = false,
}: {
  item: ItemView;
  ticks: RowTicks;
  className?: string;
  /** The laptop's Next column: the stage as a chip (the approved sample). */
  chip?: boolean;
}) {
  const step = nextStep(item);
  // One line (fix A): a long stage name ends in an ellipsis, its full name on hover or long press.
  const base = cn(
    "flex max-w-full min-w-0 items-center gap-1 text-xs",
    chip && step.kind === "stage" && "border-border bg-card min-h-7 rounded-full border px-2.5",
    className,
  );
  if (step.kind === "stage") {
    const stage = item.stages.find((candidate) => candidate.id === item.nextStageId);
    const words = (
      <>
        <span className={cn("text-muted-foreground shrink-0", chip && "sr-only")}>Next:</span>{" "}
        <span className="text-foreground min-w-0 truncate font-medium" title={step.name}>
          {step.name}
        </span>
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
            "pressable group/next focus-visible:ring-ring text-left focus-visible:ring-2 focus-visible:outline-none disabled:opacity-70",
            chip
              ? "hover:bg-muted"
              : "-mx-1 rounded-md px-1 hover:underline hover:underline-offset-4",
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

type CheckKind = "ticked" | "next" | "later";

function checkKind(item: ItemView, stage: ItemStageView): CheckKind {
  if (stage.done) return "ticked";
  return stage.id === item.nextStageId ? "next" : "later";
}

const CHECK_WORDS: Record<CheckKind, string> = { ticked: "ticked", next: "next", later: "to do" };

/** The next stage is bold and outlined (fix F); a ticked one plain, the later ones muted. */
const CHECK_LOOK: Record<CheckKind, string> = {
  ticked: "border-transparent text-foreground",
  next: "border-foreground/70 text-foreground font-semibold",
  later: "border-transparent text-muted-foreground",
};

/** The tick box: filled `strong` with a check when ticked (never red), an empty square when not. */
function CheckBox({ ticked }: { ticked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border",
        ticked ? "border-strong bg-strong text-strong-foreground" : "border-control-border",
      )}
    >
      {ticked ? <CheckIcon className="size-3" /> : null}
    </span>
  );
}

/**
 * One stage group's checklist while the row is open (V3, the long-stage-list fixes B and F): tick
 * box and name, left-aligned, at most two lines then an ellipsis (the full name on hover), in
 * three columns on a laptop, two on a tablet and one on a phone, never centred chips. For whoever
 * may tick, each line ticks or unticks its stage in one tap ("Tick Cut", "Untick Cut"; unit U),
 * 44 px tall on a phone; otherwise it only reads.
 */
function StageChecklist({
  item,
  group,
  heading,
  ticks,
}: {
  item: ItemView;
  group: ItemStageGroupView;
  /** The group's heading ("Edit 2/3"), or none for a deliverable with one untitled group. */
  heading: string | null;
  ticks: RowTicks;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-slot="item-stage-group">
      {heading ? (
        <p
          data-slot="item-stage-group-label"
          className="text-muted-foreground flex min-w-0 items-baseline gap-2 text-xs font-medium"
        >
          <span className="min-w-0 truncate" title={heading}>
            {heading}
          </span>
          <span className="shrink-0 tabular-nums">
            {group.done}/{group.stages.length}
          </span>
        </p>
      ) : null}
      <ul className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-0.5 md:grid-cols-2 lg:grid-cols-3">
        {group.stages.map((stage) => {
          const kind = checkKind(item, stage);
          const look = cn(
            "flex min-h-11 w-full min-w-0 items-start gap-2 rounded-md border px-2 py-1.5 text-left text-sm lg:min-h-8 lg:py-1",
            CHECK_LOOK[kind],
          );
          const inside = (
            <>
              <CheckBox ticked={stage.done} />
              <span className="line-clamp-2 min-w-0 break-words" title={stage.name}>
                {stage.name}
              </span>
              <span className="sr-only">, {CHECK_WORDS[kind]}</span>
            </>
          );
          if (!ticks.can) {
            return (
              <li key={stage.id} className="min-w-0">
                <span data-slot="stage-check" data-check={kind} className={look}>
                  {inside}
                </span>
              </li>
            );
          }
          const verb = stage.done ? "Untick" : "Tick";
          return (
            <li key={stage.id} className="min-w-0">
              <button
                type="button"
                data-slot="stage-check"
                data-check={kind}
                aria-label={`${verb} ${stage.name}`}
                title={`${verb} ${stage.name}`}
                disabled={ticks.pending !== null}
                aria-busy={ticks.pending === stage.id || undefined}
                onClick={() => ticks.tick(stage, !stage.done)}
                className={cn(
                  look,
                  OVER_ROW,
                  "pressable-row hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none disabled:opacity-70",
                )}
              >
                {inside}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The collapsed row's progress (V3, fixes A and C): a chevron, one continuous bar over every stage
 * and "n/m"; a tap opens the row in place to its checklist. Opening is a **view control**
 * (ARCHITECTURE §14.2 d): no address, no history entry; back still leaves the page.
 */
function ProgressToggle({
  item,
  open,
  controls,
  onToggle,
  className,
}: {
  item: ItemView;
  open: boolean;
  controls: string;
  onToggle: () => void;
  className?: string;
}) {
  const progress = itemProgress(item);
  if (progress.total === 0) {
    // A laptop's progress column says so; a phone's card says it in its Next line.
    return (
      <span
        data-slot="item-progress"
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
  const verb = open ? "Hide" : "Show";
  if (progressShape(item) === "groups") {
    // One line per group (owner 2026-10-21, the approved sample): name · segmented bar · n/m.
    return (
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? controls : undefined}
        title={`${verb} the stages of ${item.title}`}
        data-slot="item-progress"
        data-shape="groups"
        onClick={onToggle}
        className={cn(
          OVER_ROW,
          "pressable-row hover:bg-muted focus-visible:ring-ring flex min-h-11 w-full min-w-0 flex-col justify-center gap-1.5 rounded-md py-1 text-left text-xs focus-visible:ring-2 focus-visible:outline-none lg:min-h-7",
          className,
        )}
      >
        {groupStrips(item).map((strip) => (
          <span
            key={strip.key}
            data-slot="item-progress-group"
            className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-x-2"
          >
            <span className="text-muted-foreground truncate" title={strip.label}>
              {strip.label}
            </span>
            <SegmentBar done={strip.done} next={strip.next} total={strip.total} />
            <span
              className="text-muted-foreground text-right tabular-nums"
              data-slot="item-progress-count"
            >
              {strip.done}/{strip.total}
              <span className="sr-only"> ticked</span>
            </span>
          </span>
        ))}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      title={`${verb} the stages of ${item.title}`}
      data-slot="item-progress"
      onClick={onToggle}
      className={cn(
        PROGRESS_GRID,
        OVER_ROW,
        "pressable-row hover:bg-muted focus-visible:ring-ring min-h-11 w-full min-w-0 rounded-md text-left text-xs focus-visible:ring-2 focus-visible:outline-none lg:min-h-7",
        className,
      )}
    >
      <ChevronRightIcon
        aria-hidden
        className={cn(
          "text-muted-foreground size-4 shrink-0 transition-transform motion-reduce:transition-none",
          open && "rotate-90",
        )}
      />
      <ProgressBar counts={progress} label={null} slot="item-progress-bar" />
      <span
        className="text-muted-foreground text-right tabular-nums"
        data-slot="item-progress-count"
      >
        {progress.done}/{progress.total}
        <span className="sr-only"> stages ticked</span>
      </span>
    </button>
  );
}

/** A group's segmented bar: a segment a stage, ticked ones green, the next one lighter. */
function SegmentBar({ done, next, total }: { done: number; next: number; total: number }) {
  return (
    <span
      aria-hidden
      data-slot="item-progress-bar"
      data-done={done}
      data-next={next}
      data-total={total}
      className="flex h-1.5 min-w-0 gap-0.5"
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            "min-w-0 flex-1 rounded-full",
            index < done ? "bg-success" : index < done + next ? "bg-success/40" : "bg-muted",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The row opened (fixes B, D, E): every group's checklist under its heading, then, for whoever
 * edits the project, the two hints a long list earns: "12 stages: split them into groups?" with
 * **Group stages** (the Admin chooses where groups start; never automatic), and the tip to use
 * "+ Another revision round" instead of typing numbered round stages.
 */
function StagesPanel({
  item,
  id,
  ticks,
  manage,
  onGroup,
  className,
}: {
  item: ItemView;
  id: string;
  ticks: RowTicks;
  manage: boolean;
  onGroup: (() => void) | undefined;
  className?: string;
}) {
  const groups = item.groups.filter((group) => group.stages.length > 0);
  const titled = groups.length > 1 || groups.some((group) => group.label !== null);
  return (
    <div
      id={id}
      role="group"
      aria-label={`Stages of ${item.title}`}
      data-slot="item-stages"
      className={cn("flex min-w-0 flex-col gap-3 pt-1 pb-2", className)}
    >
      {groups.map((group) => (
        <StageChecklist
          key={group.label ?? ""}
          item={item}
          group={group}
          heading={titled ? (group.label ?? UNTITLED_GROUP_LABEL) : null}
          ticks={ticks}
        />
      ))}
      {manage && onGroup && suggestsGrouping(item) ? (
        <p
          data-slot="item-group-hint"
          className={cn(OVER_ROW, "flex flex-wrap items-center gap-x-3 gap-y-1 text-sm")}
        >
          <span className="text-muted-foreground">
            {item.stages.length} stages: split them into groups?
          </span>
          <Button variant="secondary" size="sm" data-slot="item-group-stages" onClick={onGroup}>
            Group stages
          </Button>
        </p>
      ) : null}
      {manage && typesNumberedRounds(item) ? (
        <p
          data-slot="item-round-tip"
          className="text-muted-foreground reading flex items-start gap-2 text-xs"
        >
          <LightbulbIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            Tip: for another round of changes, open the deliverable and use &ldquo;+ Another
            revision round&rdquo;. It adds the round in the right place, so there is no need to type
            numbered round stages.
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** How Mark done looks on a row: quiet for a deliverable without stages, outlined once every
 * stage is ticked, solid on the one row that is the layer's commit action. */
export type MarkDoneLook = "quiet" | "ready" | "solid";

// The ready row's solid Mark done is the Forest green approve commit (owner 2026-10-21).
const LOOK_VARIANT = { quiet: "ghost", ready: "secondary", solid: "approve" } as const;

/**
 * One deliverable on the project page (6b.11; E+ and U, the owner's feedback of 2026-10-16). **A
 * tap anywhere on the row opens its sheet** (the title is the button, stretched over the row; a
 * "›" at its right edge says so), except on its own controls: the strips (each opens in place to
 * its chips, which tick or untick in one tap), "Next: ‹stage›" (ticks it), Mark done and ⋯. **A
 * laptop row** reads across aligned columns: the title over its "Carried from …"; one strip per
 * stage group; "Next: ‹stage›"; the planned date; Mark done or ⋯. **A phone card**: the title over
 * its planned date and its Next line, Mark done or ⋯ beside it, then the strips (each a 44 px
 * target), then the send-back note. **Mark done** shows on the row once every stage is ticked
 * (outlined; the first such row's is the layer's one solid commit) or when there are no stages
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
  manage = false,
  onGroup,
}: {
  /** The viewer edits the project (`projects.manage`, workable): the open row's hints show. */
  manage?: boolean;
  /** Opens "Group stages" for this deliverable (fix D), held by the list. */
  onGroup?: (() => void) | undefined;
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
  // Collapsed by default (fix A); opening is a view control, never history (§14.2 d).
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
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
      <span className="text-muted-foreground hidden text-xs lg:block" data-slot="item-groups-line">
        {groupsLine(item)}
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
      <ProgressToggle
        item={item}
        open={expanded}
        controls={panelId}
        onToggle={() => setExpanded((current) => !current)}
        className={cn("order-last basis-full lg:order-none", indent)}
      />
      {/* Next, its own column on a laptop: the stage as a chip, or, once every stage is ticked,
          Mark done itself (the Forest green commit on the first ready row). On a phone this cell
          shows only to hold Mark done, beside the card's title. */}
      <span
        data-slot="item-next-cell"
        className={cn(
          "items-center",
          place === "row" ? "ml-auto flex min-h-11 lg:ml-0 lg:min-h-7" : "hidden min-h-7 lg:flex",
        )}
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
        ) : nextStep(item).kind === "none" ? null : (
          <NextText item={item} ticks={ticks} chip />
        )}
      </span>
      <span data-slot="item-planned-cell" className="hidden min-h-7 items-center text-xs lg:flex">
        <PlannedText item={item} short />
      </span>
      <span
        data-slot="item-action"
        className={cn(
          "flex min-h-11 shrink-0 items-center justify-end gap-1 lg:ml-0 lg:min-h-7",
          place === "row" ? undefined : "ml-auto",
        )}
      >
        {place !== null ? (
          <RowMenu
            title={item.title}
            disabled={waiting}
            // A phone card with Mark done on it keeps one action beside the title (375 px).
            className={cn(OVER_ROW, place === "row" && "max-lg:hidden")}
            onOpen={onOpen}
            onMarkDone={onMarkDone}
            unticked={item.stages.filter((stage) => !stage.done).length}
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
      {expanded ? (
        <StagesPanel
          item={item}
          id={panelId}
          ticks={ticks}
          manage={manage}
          onGroup={onGroup}
          className={cn(
            "order-last basis-full lg:order-none",
            selecting ? "pl-12 lg:col-[2/-1] lg:pl-0" : "lg:col-span-full",
          )}
        />
      ) : null}
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
