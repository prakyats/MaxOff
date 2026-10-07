import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClockIcon,
  MailWarningIcon,
  MapPinIcon,
  UserXIcon,
  WifiOffIcon,
} from "lucide-react";
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

import { LinkRow, Marker, QuietText, RowList, ShowFirst } from "./blocks";

/**
 * The dashboards' day blocks (6A): event rows, the risk rows, the events strip and the clients'
 * counts. Server components only (the first-load budget, 6.0); see `blocks.tsx`.
 */

const EVENT_ROW =
  "focus-visible:ring-ring flex min-h-14 items-start gap-3 px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset";

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

const RISK_ICONS = {
  overdue: AlertTriangleIcon,
  not_noted: ClockIcon,
  on_leave: UserXIcon,
  unreachable: WifiOffIcon,
} as const;

/** One risk as a row (decisions 6, 10): what it is, about whom, and where a tap goes. */
function riskRow(
  risk: Risk,
  context: { nameOf: (id: string) => string; today: ISODate; now: Date },
): ReactNode {
  const words = riskWords(risk, context);
  const Icon = RISK_ICONS[words.icon];
  const key =
    "taskId" in risk
      ? `${risk.kind}-${risk.taskId}-${"memberId" in risk ? risk.memberId : ""}`
      : `${risk.kind}-${risk.memberId}`;
  return (
    <LinkRow
      key={key}
      href={words.href}
      slot="risk-row"
      icon={<Icon className="size-4" aria-hidden />}
      title={words.title}
      detail={words.detail}
      trailing={<Marker label={words.marker.label} tone={words.marker.tone} />}
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
                    className="focus-visible:ring-ring flex min-h-11 items-center gap-3 px-4 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
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
