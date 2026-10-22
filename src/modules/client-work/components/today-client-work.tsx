"use client";

import { useState, useSyncExternalStore } from "react";

import { cn } from "@/core/lib/utils";
import { ErrorText } from "@/core/ui/composites/error-text";
import { Button } from "@/core/ui/primitives/button";
import { ProgressBar } from "@/core/ui/progress/segmented-meter";

import { readyToMarkDone } from "../domain/deliverable";
import { itemMeter } from "../domain/progress";
import type { ItemView } from "../domain/views";

import { ItemSheet, type ItemPermissions } from "./item-sheet";
import { tickWithUndo } from "./tick-with-undo";
import { MARK_DONE_URL, useUndoSends } from "./use-undo-sends";

/** Nothing to subscribe to: the value only changes from the server's HTML to the client's. */
const noChanges = () => () => {};

export type TodayItem = {
  view: ItemView;
  /** "Monthly reels · Sharma Weddings". */
  where: string;
  href: string;
};

/**
 * The Admin's **Client work** on Today (7.3; PRODUCT §4.7, kickoff 7 decision 19): the items
 * overdue or due this week, oldest first (the server sends at most five), each with its own stages
 * in miniature (6b.11 (5)). Each row has one quiet action (N5, UX review 2026-10-21: no Mark done
 * at 0/6): **Next: ‹stage›** while stages are left, a one-tap tick of that stage with Undo (as the
 * project page's rows), and once every stage is ticked (or there are none) one neutral
 * **Mark done**, instant with the 6-second Undo (a delayed send, flushed when the app is hidden or
 * left, as Approvals' Approve; done is the approval since amendment D3), and a tap on the row
 * opens the item sheet (its own stages, notes, last change) with a way to the project; the sheet's
 * Mark done takes the same Undo. A row stays, faded, until the server's refreshed list arrives. Loaded after
 * the page (`today/client-work-lazy.tsx`): Today's first load never grows (ARCHITECTURE §19).
 */
export function TodayClientWork({
  items,
  permissions,
}: {
  items: readonly TodayItem[];
  permissions: ItemPermissions;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The Next tick on its way (N5): its button waits.
  const [ticking, setTicking] = useState<string | null>(null);
  const { held, errors, start } = useUndoSends({
    url: MARK_DONE_URL,
    body: (id) => ({ id }),
    said: (title) => `Marked ${title} done`,
    notDone: "It was not marked done.",
    tooLate: "Undo came too late: it was marked done.",
    toastKey: "item-done",
  });

  const open = items.find((item) => item.view.id === openId) ?? null;
  // False in the server's HTML, true once this chunk has hydrated: its rows answer taps from then
  // (`data-ready`; a tap on the server's rows before it reaches no handler, PROGRESS 6A (7)).
  const ready = useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );
  return (
    <>
      <ul
        aria-label="Client work"
        data-slot="today-client-work-rows"
        data-ready={ready ? "" : undefined}
        className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
      >
        {items.map((item) => {
          const waiting = held.has(item.view.id);
          const meter = itemMeter(item.view);
          return (
            <li
              key={item.view.id}
              data-slot="today-client-item"
              data-held={waiting ? "" : undefined}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 transition-opacity",
                waiting && "opacity-50",
              )}
            >
              <button
                type="button"
                onClick={() => setOpenId(item.view.id)}
                className="pressable-row flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center gap-0.5 text-left"
              >
                <span className="text-sm font-medium break-words">{item.view.title}</span>
                <span className="text-muted-foreground text-xs break-words">
                  {item.where}
                  {item.view.planned ? (
                    <>
                      {" · "}
                      <span
                        data-slot="today-item-planned"
                        className={cn(item.view.planned.overdue && "text-danger")}
                      >
                        {item.view.planned.text}
                      </span>
                    </>
                  ) : null}
                </span>
                {meter.total > 0 ? (
                  // The deliverable's own stages in miniature (6b.11 (5)).
                  <span className="mt-0.5 flex items-center gap-2 text-xs">
                    <ProgressBar
                      counts={meter}
                      label={`Stages ${meter.done} of ${meter.total} ticked`}
                      slot="today-item-meter"
                      className="w-20 shrink-0"
                    />
                    <span className="text-muted-foreground tabular-nums">
                      {meter.done}/{meter.total}
                    </span>
                  </span>
                ) : null}
              </button>
              {permissions.tick ? (
                <RowAction
                  view={item.view}
                  waiting={waiting}
                  ticking={ticking}
                  onTick={(stage) => void tickWithUndo(stage, true, item.view.title, setTicking)}
                  onMarkDone={() => start(item.view.id, item.view.title)}
                />
              ) : null}
              {errors[item.view.id] ? (
                <ErrorText className="basis-full">{errors[item.view.id]}</ErrorText>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ItemSheet
        item={open?.view ?? null}
        permissions={permissions}
        open={open !== null}
        onOpenChange={(next) => (next ? null : setOpenId(null))}
        onMarkDone={(item) => start(item.id, item.title)}
        {...(open ? { projectHref: open.href } : {})}
      />
    </>
  );
}

/**
 * N5: "Next: ‹stage›" (outlined, ticks it with Undo) until every stage is ticked, then a neutral
 * Mark done; a deliverable without stages has Mark done only. Nothing for one the viewer may not
 * tick.
 */
function RowAction({
  view,
  waiting,
  ticking,
  onTick,
  onMarkDone,
}: {
  view: ItemView;
  waiting: boolean;
  ticking: string | null;
  onTick: (stage: ItemView["stages"][number]) => void;
  onMarkDone: () => void;
}) {
  const next = view.stages.find((stage) => stage.id === view.nextStageId);
  if (view.stages.length === 0 || readyToMarkDone(view)) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="ml-auto shrink-0"
        disabled={waiting}
        data-slot="today-item-done"
        onClick={onMarkDone}
      >
        Mark done
      </Button>
    );
  }
  if (!next || !view.rules.ticks) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      className="ml-auto max-w-[min(14rem,100%)] shrink-0"
      disabled={waiting || ticking !== null}
      aria-busy={ticking === next.id || undefined}
      data-slot="today-item-next"
      aria-label={`Tick ${next.name}`}
      title={`Tick ${next.name}`}
      onClick={() => onTick(next)}
    >
      <span className="text-muted-foreground shrink-0">Next:</span>
      <span className="min-w-0 truncate">{next.name}</span>
    </Button>
  );
}
