import { CalendarDaysIcon, ChevronRightIcon, MailWarningIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { CARD_ROW_TITLE } from "@/core/ui/composites/row-metrics";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import type { ISODate } from "@/core/time";

import { clockWord, dayWord } from "../domain/days";
import type { DayEvent } from "../domain/my-day";
import {
  type HeldEmails,
  heldEmailsLine,
  onLeaveLine,
  type Risk,
  riskWords,
  RISKS_SHOWN,
  STRIP_EMPTY,
  type StripDay,
} from "../domain/today";
import { SEE_THE_WEEK_HREF, type WeekLine, weekLineHref } from "../domain/week";

import { LinkRow, QuietText, RowList, ShowFirst } from "./blocks";

/**
 * The dashboards' day blocks (6A): event rows, the risk rows, the events strip and the clients'
 * counts. Server components only (the first-load budget, 6.0); see `blocks.tsx`.
 */

const EVENT_ROW =
  "focus-visible:ring-ring flex min-h-14 flex-wrap items-start gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset";

/** "10:00 am" or "All day", and the day word when the list spans days. */
function eventWhen(event: DayEvent, today: ISODate, withDay: boolean): string {
  const time = event.eventStartAt ? clockWord(event.eventStartAt) : "All day";
  return withDay ? `${dayWord(event.eventDate, today)} · ${time}` : time;
}

/**
 * Event tasks as rows: the time, the title, the location (decision 2), each opening the task. A
 * coordinator's freelancer's event says whose it is (`note`).
 */
export function EventRows<T extends DayEvent>({
  events,
  today,
  label,
  slot,
  note,
}: {
  events: readonly T[];
  today: ISODate;
  label: string;
  slot: string;
  note?: (event: T) => string | null;
}) {
  return (
    <RowList label={label} slot={slot}>
      {events.map((event) => {
        const who = note?.(event) ?? null;
        return (
          <li key={event.id} data-slot="event-row" data-task={event.id}>
            <DrillLink href={`/tasks/${event.id}`} className={EVENT_ROW}>
              <span className="text-muted-foreground w-24 shrink-0 pt-px text-xs tabular-nums">
                {eventWhen(event, today, true)}
              </span>
              <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
                <span className="font-medium break-words">{event.title}</span>
                {event.location || who ? (
                  <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs break-words">
                    {event.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPinIcon className="size-3 shrink-0" aria-hidden />
                        {event.location}
                      </span>
                    ) : null}
                    {who ? <span>{who}</span> : null}
                  </span>
                ) : null}
              </span>
              <ChevronRightIcon
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
                aria-hidden
              />
            </DrillLink>
          </li>
        );
      })}
    </RowList>
  );
}

export function EventRowsSkeleton({ rows }: { rows: number }) {
  return (
    <ul
      aria-hidden
      className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
    >
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} className={cn(EVENT_ROW, "min-w-0")}>
          <span className="flex h-4 w-24 shrink-0 items-center pt-px">
            <Skeleton className="h-3 w-20" />
          </span>
          <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
            <span className="flex h-5 min-w-0 items-center">
              <Skeleton className="h-4 w-40 max-w-full" />
            </span>
            <span className="flex h-4 min-w-0 items-center">
              <Skeleton className="h-3 w-28 max-w-full" />
            </span>
          </span>
          <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
        </li>
      ))}
    </ul>
  );
}

/** The one status signal's colours: the meta line and its dot (owner 2026-10-09). */
const RISK_TONE = {
  danger: { text: "text-danger", dot: "bg-danger" },
  attention: { text: "text-attention", dot: "bg-attention" },
} as const;

/**
 * One risk as a row (decisions 6, 10): what it is, about whom, and where a tap goes. **One status
 * signal** (the owner's preview review, 2026-10-09): the meta line in red (overdue) or amber (the
 * rest) with a small dot of the same colour before it; no icon, no chip, the same for every kind.
 */
function riskRow(
  risk: Risk,
  context: { nameOf: (id: string) => string; today: ISODate; now: Date },
): ReactNode {
  const words = riskWords(risk, context);
  const tone = RISK_TONE[words.tone];
  const key =
    "taskId" in risk
      ? `${risk.kind}-${risk.taskId}-${"memberId" in risk ? risk.memberId : ""}`
      : `${risk.kind}-${risk.memberId}`;
  return (
    <LinkRow
      key={key}
      href={words.href}
      slot="risk-row"
      title={words.title}
      detail={
        <span
          data-slot="risk-signal"
          data-tone={words.tone}
          className={cn("inline-flex max-w-full items-baseline gap-1.5", tone.text)}
        >
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 self-center rounded-full", tone.dot)}
          />
          <span className="min-w-0 break-words">{words.detail}</span>
        </span>
      }
    />
  );
}

/**
 * Overdue and risks (the Owner, decision 6) or Issues (an Admin, decision 10): rows, the first
 * five, then "See all". The emails-held row (the Owner, decision 23) follows, outside the five.
 */
export function RiskRows({
  risks,
  held,
  empty,
  label,
  slot,
  nameOf,
  today,
  now,
}: {
  risks: readonly Risk[];
  /** The Owner's held emails; null for an Admin. */
  held: HeldEmails | null;
  /** What shows when there is no row at all (null: the section is hidden by the caller). */
  empty: ReactNode;
  label: string;
  slot: string;
  nameOf: (id: string) => string;
  today: ISODate;
  now: Date;
}) {
  const line = held ? heldEmailsLine(held) : null;
  if (risks.length === 0 && !line) return <>{empty}</>;
  const context = { nameOf, today, now };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {risks.length > 0 ? (
        <ShowFirst
          rows={risks.map((risk) => riskRow(risk, context))}
          shown={RISKS_SHOWN}
          label={label}
          slot={slot}
        />
      ) : null}
      {line ? (
        <RowList label="Emails held back">
          <LinkRow
            href="/settings/thresholds"
            slot="risk-emails-held"
            icon={<MailWarningIcon className="size-4" aria-hidden />}
            title={line.title}
            detail={line.detail}
          />
        </RowList>
      ) : null}
    </div>
  );
}

/**
 * The events strip (decision 12): today and the next six days, event tasks and holidays, at most
 * five rows, then "Open calendar". The Owner's also says "N on leave" per day.
 */
export function EventsStrip<T extends DayEvent>({
  days,
  hidden,
  today,
}: {
  days: readonly StripDay<T>[];
  hidden: number;
  today: ISODate;
}) {
  if (days.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <QuietText slot="events-strip-empty">{STRIP_EMPTY}</QuietText>
        <CalendarLink label="Open calendar" />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2" data-slot="events-strip">
      <ul
        aria-label="The next 7 days"
        className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
      >
        {days.map((day) => (
          <li key={day.date} data-slot="strip-day" data-date={day.date} className="flex flex-col">
            <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 px-4 pt-2 text-xs">
              <span className="font-semibold">{dayWord(day.date, today)}</span>
              {day.onLeave ? (
                <span className="text-muted-foreground" data-slot="strip-on-leave">
                  {onLeaveLine(day.onLeave)}
                </span>
              ) : null}
            </div>
            <ul className="flex flex-col pb-1">
              {day.holiday ? (
                <li
                  data-slot="strip-holiday"
                  className="flex min-h-11 items-center gap-3 px-4 text-sm"
                >
                  <CalendarDaysIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="break-words">Holiday: {day.holiday}</span>
                </li>
              ) : null}
              {day.events.map((event) => (
                <li key={event.id} data-slot="strip-event">
                  <DrillLink
                    href={`/tasks/${event.id}`}
                    // `flex-wrap`, as every row with `CARD_ROW_TITLE`: at large system text the
                    // time, the title's 6rem and the chevron no longer fit one line at 375px.
                    className="focus-visible:ring-ring flex min-h-11 flex-wrap items-center gap-3 px-4 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  >
                    <span className="text-muted-foreground w-16 shrink-0 text-xs tabular-nums">
                      {event.eventStartAt ? clockWord(event.eventStartAt) : "All day"}
                    </span>
                    <span className={cn("flex flex-col", CARD_ROW_TITLE)}>
                      <span className="font-medium break-words">{event.title}</span>
                      {event.location ? (
                        <span className="text-muted-foreground text-xs break-words">
                          {event.location}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRightIcon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                  </DrillLink>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <CalendarLink label={hidden > 0 ? `Open calendar · ${hidden} more` : "Open calendar"} />
    </div>
  );
}

/**
 * The Owner's "This week" (the Today refresh, owner 2026-10-09): `weekLines`' lines, the day or
 * the person first, every other word labelled, opening the calendar on its first day; "See the
 * week" only when lines were cut. The section's header carries "Calendar ›"
 * (`CalendarHeaderLink`).
 */
export function WeekLines({
  lines,
  hidden,
  today,
}: {
  lines: readonly WeekLine[];
  hidden: number;
  today: ISODate;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2" data-slot="week-lines">
      <RowList label="The next 7 days">
        {lines.map((line) => {
          const [lead, ...rest] = line.parts;
          return (
            <li key={line.key} data-slot="week-line" data-kind={line.kind} data-date={line.date}>
              <Link
                href={weekLineHref(line, today)}
                className="pressable-row focus-visible:ring-ring flex min-h-11 min-w-0 items-center gap-3 px-4 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
              >
                {/* Never cut short (owner 2026-10-09): the words are short and labelled ("3 due",
                    "Shoot 11:49"), an event's title is capped in the words themselves, and a
                    long line wraps, at large system text too (§14.2 i). */}
                <span data-slot="week-line-text" className="min-w-0 flex-1 break-words">
                  <span className="font-medium">{lead}</span>
                  {rest.length > 0 ? ` · ${rest.join(" · ")}` : null}
                </span>
                <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              </Link>
            </li>
          );
        })}
      </RowList>
      {hidden > 0 ? (
        <RowList label="The rest of the week">
          <LinkRow href={SEE_THE_WEEK_HREF} slot="today-see-the-week" title="See the week" tab />
        </RowList>
      ) : null}
    </div>
  );
}

/** "Calendar ›" beside a section's heading: another tab, a 44px target on a 20px line. */
export function CalendarHeaderLink() {
  return (
    <Link
      href="/calendar"
      data-slot="open-calendar"
      className="pressable focus-visible:ring-ring text-muted-foreground hover:text-foreground -my-3 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2"
    >
      Calendar
      <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
    </Link>
  );
}

function CalendarLink({ label }: { label: string }) {
  return (
    <Link
      href="/calendar"
      data-slot="open-calendar"
      className="pressable-row border-border bg-card focus-visible:ring-ring flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-2"
    >
      <span className="min-w-0 break-words">{label}</span>
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </Link>
  );
}

/** The strip while Today loads: two days with a row each, and the calendar link. */
export function EventsStripSkeleton() {
  return (
    <div aria-hidden className="flex min-w-0 flex-col gap-2">
      <ul className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border">
        {[0, 1].map((day) => (
          <li key={day} className="flex flex-col">
            <div className="flex min-h-9 items-center px-4 pt-2">
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex min-h-11 items-center gap-3 px-4 py-1.5 pb-1">
              <Skeleton className="h-3 w-14 shrink-0" />
              <Skeleton className="h-4 w-40 max-w-full" />
            </div>
          </li>
        ))}
      </ul>
      <div className="border-border bg-card flex min-h-12 items-center justify-between rounded-lg border px-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-4 rounded-sm" />
      </div>
    </div>
  );
}
