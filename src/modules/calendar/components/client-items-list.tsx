"use client";

import { BoxIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/core/lib/utils";
import { OverlayLink } from "@/core/ui/composites/overlay-link";

import type { ClientItemEntry } from "../domain/calendar";
import { clientWorkRows } from "../domain/show";
import { DoneTick, HeldWord } from "./calendar-chip";

/**
 * "Client work · n" after the tasks (SCOPE §6, the approved calendar sample; kickoff 7 decision 21):
 * grouped by client, each row the client first, then the deliverable and its project, done ones
 * muted, a late one saying so in red; a tap opens the project on the item's cycle with its sheet
 * open. The Owner's and the client's Admin's only (the page reads none for Crew). The full text,
 * wrapped: the popup is where a chip's cut words are read whole.
 */
export function ClientItemsList({
  items,
  headingId,
  late,
}: {
  items: readonly ClientItemEntry[];
  headingId: string;
  /** The day is past: its open work is late. */
  late: boolean;
}) {
  return (
    <section
      aria-labelledby={headingId}
      data-slot="calendar-items-list"
      className="flex flex-col gap-2"
    >
      <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold">
        <BoxIcon className="text-muted-foreground size-4" aria-hidden />
        Client work <span className="text-muted-foreground font-medium">· {items.length}</span>
      </h3>
      <ul className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border">
        {clientWorkRows(items).map((item) => (
          <li key={item.id} className="min-w-0">
            <OverlayLink
              href={item.href}
              data-slot="calendar-item"
              data-item={item.id}
              data-client={item.client}
              className={cn(
                "focus-visible:ring-ring flex min-h-14 items-center gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset",
                item.done && "text-muted-foreground",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-semibold break-words">
                  {item.done ? <DoneTick className="mr-1" /> : null}
                  {item.client}
                </span>
                <span className="text-muted-foreground text-xs break-words">
                  {item.title} · {item.project}
                  {item.done ? " · done" : ""}
                  {late && !item.done && !item.held ? (
                    <span className="text-danger"> · late</span>
                  ) : null}
                </span>
              </span>
              {item.held ? <HeldWord /> : null}
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            </OverlayLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
