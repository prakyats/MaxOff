"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Deliverable, StageGroup } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";

import {
  entryCounts,
  type PreviewEntry,
  previewEntries,
  previewStats,
  statsLine,
  statsTiles,
} from "./preview-model";

/**
 * The live preview (ROADMAP 6b.16 (a); owner feedback 2026-10-15, issue #89): exactly what will
 * be created. On top, pinned while the list scrolls, the summary as three figures (deliverables,
 * groups, stages); under it one card per deliverable, or per numbered run of identical ones
 * ("Item 1–4" ×4, tap to see the names), each tagged "Default stages" or "Own stages", with its
 * groups as small headings over their stages as a row of steps. Read-only and neutral (no red:
 * red is the commit button's). An entry that changes flashes once, without moving anything,
 * and not at all with reduced motion.
 */
export function DeliverablesPreview({
  deliverables,
  defaults,
  className,
}: {
  deliverables: readonly Deliverable[];
  defaults: readonly StageGroup[];
  className?: string;
}) {
  const stats = previewStats(deliverables, defaults);
  const entries = previewEntries(deliverables, defaults);
  return (
    <section
      aria-label="Preview"
      data-slot="deliverables-preview"
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <div
        data-slot="preview-summary"
        className="bg-popover sticky top-0 z-10 -mx-1 px-1 pt-0.5 pb-2"
      >
        <ul
          aria-label={statsLine(stats)}
          data-slot="preview-counts"
          className="grid grid-cols-3 gap-2"
        >
          {statsTiles(stats).map((tile) => (
            <li
              key={tile.id}
              data-slot="preview-stat"
              data-stat={tile.id}
              className="bg-muted/60 flex min-w-0 flex-col rounded-lg px-2.5 py-2"
            >
              <span className="text-lg leading-tight font-semibold tabular-nums">
                {tile.figure}
              </span>{" "}
              <span className="text-muted-foreground truncate text-xs">{tile.word}</span>
            </li>
          ))}
        </ul>
      </div>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing to create yet: add deliverables to see them here.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((entry) => (
            <EntryCard key={entry.start} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}

function EntryCard({ entry }: { entry: PreviewEntry }) {
  const [open, setOpen] = useState(false);
  const run = entry.titles.length > 1;
  const signature = JSON.stringify([entry.titles, entry.own, entry.groups]);
  const card = useRef<HTMLLIElement>(null);
  const seen = useRef(signature);

  // A brief highlight when this entry changes (not on first draw); colour only, so nothing moves.
  useEffect(() => {
    if (seen.current === signature) return;
    seen.current = signature;
    const node = card.current;
    if (!node) return;
    node.dataset.changed = "";
    const timer = setTimeout(() => delete node.dataset.changed, 700);
    return () => clearTimeout(timer);
  }, [signature]);

  const header = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className="min-w-0 text-sm font-medium break-words"
        data-slot="preview-deliverable-title"
      >
        {entry.label}
      </span>
      {run ? (
        <span
          data-slot="preview-quantity"
          className="bg-muted rounded-full px-1.5 text-xs font-medium tabular-nums"
        >
          ×{entry.titles.length}
        </span>
      ) : null}
      <span
        data-slot="preview-tag"
        className="border-border text-muted-foreground rounded-full border px-1.5 text-[0.7rem]"
      >
        {entry.own ? "Own stages" : "Default stages"}
      </span>
    </span>
  );

  return (
    <li
      ref={card}
      data-slot="preview-deliverable"
      className="border-border motion-safe:data-changed:bg-muted flex min-w-0 flex-col gap-2 rounded-lg border p-2.5 motion-safe:transition-colors motion-safe:duration-500"
    >
      {run ? (
        <button
          type="button"
          aria-expanded={open}
          data-slot="preview-run-toggle"
          className="pressable-row -m-1 flex min-h-11 min-w-0 items-center gap-2 rounded-md p-1 text-left"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="min-w-0 flex-1">{header}</span>
          <ChevronDownIcon aria-hidden className={cn("size-4 shrink-0", open && "rotate-180")} />
        </button>
      ) : (
        header
      )}
      <p className="text-muted-foreground text-xs" data-slot="preview-entry-counts">
        {entryCounts(entry)}
      </p>
      {run && open ? (
        <ul data-slot="preview-run-names" className="flex flex-wrap gap-1 text-xs">
          {entry.titles.map((title, index) => (
            <li key={index} className="bg-muted rounded px-1.5 py-0.5 break-words">
              {title}
            </li>
          ))}
        </ul>
      ) : null}
      {entry.groups.length === 0 ? (
        <p className="text-muted-foreground text-xs">No stages</p>
      ) : (
        entry.groups.map((group, at) => (
          <div key={at} data-slot="preview-group" className="flex min-w-0 flex-col gap-1">
            {group.label !== null ? (
              <p
                className="text-muted-foreground text-[0.7rem] font-medium tracking-wide break-words uppercase"
                data-slot="preview-group-label"
              >
                {group.label}
              </p>
            ) : null}
            <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
              {group.stages.map((stage, position) => (
                <li key={position} className="flex min-w-0 items-center gap-1">
                  {position > 0 ? (
                    <ChevronRightIcon
                      aria-hidden
                      className="text-muted-foreground size-3 shrink-0"
                    />
                  ) : null}
                  <span
                    data-slot="preview-stage"
                    className="border-border bg-background rounded-md border px-1.5 py-0.5 text-xs break-words"
                  >
                    {stage}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </li>
  );
}
