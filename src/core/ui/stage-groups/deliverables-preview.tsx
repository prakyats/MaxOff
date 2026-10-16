"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { type Deliverable, flattenGroups, type StageGroup } from "@/core/lib/stage-groups";
import { cn } from "@/core/lib/utils";
import { SegmentedBar } from "@/core/ui/progress/segmented-meter";

import {
  entryCounts,
  type PreviewEntry,
  previewEntries,
  previewKeys,
  previewStats,
  statsLine,
  statsTiles,
} from "./preview-model";

/**
 * The live preview (ROADMAP 6b.16 (a); owner feedback 2026-10-15, issue #89): exactly what will
 * be created. On top, pinned while the list scrolls, the summary as three figures (deliverables,
 * groups, stages); under it one card per deliverable, or per run of identical neighbours ("Item
 * 1–4" ×4, "A, B" ×2; tap to see the names), each tagged "Default stages" or "Own stages", with a
 * row of stage dots in the progress meter's language (6b.11) and its groups as small headings over
 * their stages as a row of steps. Read-only and neutral (no red: red is the commit button's). An
 * entry that changes flashes once, without moving anything, and not at all with reduced motion;
 * the cards are keyed to their deliverables (`previewKeys`), never to their place, so an insert
 * above flashes nothing else.
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
  const keys = useStableKeys(deliverables.map((deliverable) => deliverable.title));
  const entries = previewEntries(deliverables, defaults, keys);
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
            <EntryCard key={entry.key} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}

type Keyed = { titles: readonly string[]; keys: readonly string[]; minted: number };

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((title, index) => title === b[index]);

/**
 * Each deliverable's stable key across edits: worked out again only when the titles change (an
 * insert, a removal, a move or a rename), kept from the previous draw (React's "state from the
 * previous render").
 */
function useStableKeys(titles: readonly string[]): readonly string[] {
  const [keyed, setKeyed] = useState<Keyed>(() => ({
    titles,
    keys: titles.map((_, index) => `d${index}`),
    minted: titles.length,
  }));
  if (same(keyed.titles, titles)) return keyed.keys;
  const keys = previewKeys(
    keyed.titles.map((title, index) => ({ title, key: keyed.keys[index] ?? `d${index}` })),
    titles,
    (n) => `d${keyed.minted + n}`,
  );
  const known = new Set(keyed.keys);
  const minted = keyed.minted + keys.filter((key) => !known.has(key)).length;
  setKeyed({ titles, keys, minted });
  return keys;
}

function EntryCard({ entry }: { entry: PreviewEntry }) {
  const [open, setOpen] = useState(false);
  const run = entry.titles.length > 1;
  const stages = flattenGroups(entry.groups).length;
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
      {stages > 0 ? (
        // One dot per stage it will start with, none ticked yet (the meter's language, 6b.11).
        <SegmentedBar
          counts={{ done: 0, next: 0, total: stages }}
          label={null}
          slot="preview-stage-dots"
          className="w-full max-w-48"
        />
      ) : null}
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
