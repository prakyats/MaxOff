"use client";

import { timeWords, type EventItem } from "../domain/calendar";
import { DoneTick } from "./calendar-chip";

/** The details shown beside a hovered (or focused) block on the laptop. */
export type Hovered = { event: EventItem; rect: DOMRect };

/** A block's details beside it, inside the viewport: a mouse's look before the click. */
export function BlockDetails({ hovered }: { hovered: Hovered }) {
  const { event, rect } = hovered;
  const width = 256;
  const gap = 8;
  const left =
    rect.right + gap + width <= window.innerWidth ? rect.right + gap : rect.left - gap - width;
  const top = Math.max(gap, Math.min(rect.top, window.innerHeight - 160));
  return (
    <div
      data-slot="calendar-event-details"
      data-task={event.id}
      // The block's own text says the same to assistive tech; this is the mouse's look.
      aria-hidden
      className="bg-popover text-popover-foreground ring-foreground/10 pointer-events-none fixed z-50 flex flex-col gap-1 rounded-lg p-3 text-xs shadow-md ring-1"
      style={{ left: Math.max(gap, left), top, width }}
    >
      <span className="flex items-start gap-2 text-sm font-medium">
        <span
          className="mt-1 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: event.color }}
        />
        <span className="min-w-0 break-words">
          {event.completed ? <DoneTick className="mr-1" /> : null}
          {event.title}
        </span>
      </span>
      <span className="text-muted-foreground tabular-nums">
        {timeWords(event.startAt, event.endAt)}
      </span>
      {event.typeName ? <span className="text-muted-foreground">{event.typeName}</span> : null}
      {event.clientName ? <span>{event.clientName}</span> : null}
      {event.location ? <span className="text-muted-foreground">{event.location}</span> : null}
      {event.people.length > 0 ? (
        <span className="text-muted-foreground break-words">{event.people.join(", ")}</span>
      ) : null}
    </div>
  );
}
