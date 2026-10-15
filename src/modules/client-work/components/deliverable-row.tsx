import { CheckIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { SegmentedBar } from "@/core/ui/progress/segmented-meter";
import { Button } from "@/core/ui/primitives/button";
import { Checkbox } from "@/core/ui/primitives/checkbox";

import { itemMeter } from "../domain/progress";
import { ITEM_STATUS } from "../domain/types";
import type { ItemStageView, ItemView } from "../domain/views";

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

type ChipKind = "ticked" | "next" | "later";

function chipKind(item: ItemView, stage: ItemStageView): ChipKind {
  if (stage.done) return "ticked";
  return stage.id === item.nextStageId ? "next" : "later";
}

const CHIP_WORDS: Record<ChipKind, string> = { ticked: "ticked", next: "next", later: "to do" };

/**
 * A deliverable's stages as chips under their groups (6b.11 (3)): a ticked stage neutral and
 * filled with a check (never red, which stays for urgency), the next one to tick outlined and
 * emphasised, the later ones muted. Each group keeps its heading and "n/m" (6b).
 */
function StageChips({ item }: { item: ItemView }) {
  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
      aria-label="Stages"
      data-slot="item-row-stages"
    >
      {item.groups.map((group) => (
        <span
          key={group.label ?? ""}
          className="inline-flex min-w-0 flex-wrap items-center gap-1"
          data-slot="item-row-stage-group"
        >
          {group.label !== null ? (
            <span className="text-muted-foreground mr-1 text-xs font-medium">
              {group.label}{" "}
              <span className="tabular-nums">
                {group.done}/{group.stages.length}
              </span>
            </span>
          ) : null}
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
      ))}
    </span>
  );
}

/**
 * A phone's compact stages (6b.11 (5) in miniature): the deliverable's own segments, "n/m" and the
 * next stage's name; the sheet holds the stages themselves.
 */
function StagesMiniature({ item }: { item: ItemView }) {
  const meter = itemMeter(item);
  const next = item.stages.find((stage) => stage.id === item.nextStageId);
  return (
    <span
      className="flex min-w-0 basis-full items-center gap-2 pb-1 pl-12 text-xs md:hidden"
      data-slot="item-row-mini"
    >
      <SegmentedBar
        counts={meter}
        label={`Stages ${meter.done} of ${meter.total} ticked`}
        slot="item-row-meter"
        className="w-20 shrink-0"
      />
      <span className="text-muted-foreground min-w-0 truncate">
        <span className="tabular-nums">
          {meter.done}/{meter.total}
        </span>
        {next ? ` · Next: ${next.name}` : null}
      </span>
    </span>
  );
}

/**
 * One deliverable on the project page (6b.11): the title (a tap opens the sheet) over its planned
 * date, "Carried from …" and the send-back note; its stage chips (a laptop's own column) or their
 * miniature (a phone); and its one action, a quiet **Mark done** (6b.11 (7)), while open for
 * whoever ticks. A done, closed or carried one shows its state word instead.
 */
export function DeliverableRow({
  item,
  selectable,
  selected,
  onToggle,
  waiting,
  action,
  onOpen,
  onMarkDone,
  error,
}: {
  item: ItemView;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  /** Marked done and waiting for the server's list: faded, its action gone. */
  waiting: boolean;
  /** Mark done is offered. */
  action: boolean;
  onOpen: () => void;
  onMarkDone: () => void;
  error: string | undefined;
}) {
  const open = item.state === "open";
  return (
    <li
      data-slot="item-row"
      data-state={item.state}
      data-held={waiting ? "" : undefined}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-opacity sm:px-4",
        "md:col-span-5 md:grid md:grid-cols-subgrid md:gap-y-1",
        waiting && "opacity-50",
      )}
    >
      {selectable ? (
        // A 44 px target around the box (§14.1).
        <label className="-ml-2 flex size-11 shrink-0 cursor-pointer items-center justify-center md:ml-0">
          <Checkbox
            aria-label={`Select ${item.title}`}
            checked={selected}
            disabled={waiting}
            onCheckedChange={onToggle}
          />
        </label>
      ) : (
        <span aria-hidden className="-ml-2 size-11 shrink-0 md:ml-0" />
      )}
      <button
        type="button"
        onClick={onOpen}
        data-slot="item-open"
        className="pressable-row flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center gap-1 text-left"
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
        <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
          {open ? null : <StatusDot status={ITEM_STATUS[item.state]} label={item.stateLabel} />}
          <PlannedText item={item} className="md:hidden" />
          {item.carriedFrom ? <span>{item.carriedFrom}</span> : null}
        </span>
      </button>
      <span className="hidden min-w-0 md:block">
        {item.stages.length > 0 ? (
          <StageChips item={item} />
        ) : (
          <span className="text-muted-foreground text-xs">No stages</span>
        )}
      </span>
      <PlannedText item={item} className="hidden text-xs md:block" />
      <span className="ml-auto flex shrink-0 justify-end md:ml-0">
        {action ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={waiting}
            data-slot="item-row-done"
            onClick={onMarkDone}
          >
            <CheckIcon aria-hidden />
            Mark done
          </Button>
        ) : null}
      </span>
      {/* Under the title on a phone, the full width of the card; the note spans the columns
          after the select box on a laptop. */}
      {item.stages.length > 0 ? <StagesMiniature item={item} /> : null}
      {item.sentBack ? (
        <SentBackNote
          slot="item-row-sent-back"
          text={item.sentBack.text}
          className="basis-full pb-1 pl-12 md:col-span-4 md:col-start-2 md:pl-0"
        />
      ) : null}
      {error ? <ErrorText className="basis-full md:col-span-5">{error}</ErrorText> : null}
    </li>
  );
}
