import { ChevronRightIcon, MailWarningIcon, MapPinIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/core/lib/utils";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { ListRow } from "@/core/ui/composites/list-row";
import { type AvatarPerson, PersonAvatar } from "@/core/ui/composites/person-avatar";
import { CARD_ROW_TITLE, CARD_ROW_TRAILING } from "@/core/ui/composites/row-metrics";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import type { ISODate } from "@/core/time";

import { clockWord, dayWord } from "../domain/days";
import type { DayEvent } from "../domain/my-day";
import {
  type HeldEmails,
  heldEmailsLine,
  type Risk,
  riskWords,
  RISKS_SHOWN,
} from "../domain/today";
import { SEE_THE_WEEK_HREF, type WeekBlock, type WeekRow } from "../domain/week";

import { DashSection, LinkRow, RowList, ShowFirst } from "./blocks";

/**
 * The dashboards' day blocks (6A): event rows, the risk rows, "This week" and the clients'
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

/**
 * One risk as a row (decisions 6, 10; PP-today-5): the one row anatomy (`ListRow`), the task or
 * person as the title, the plain-words reason on the muted meta line ("Asha hasn't noted it"),
 * and the reason as a chip on the right ("3 h late" red, "Not noted · 24 h" amber), then ›. The
 * person it is about (the overdue task's primary owner, the first not to note it, the one on leave
 * or unreachable) leads with their photo, from the directory the page already read (#89).
 */
function riskRow(
  risk: Risk,
  context: {
    nameOf: (id: string) => string;
    faceOf?: ((id: string) => AvatarPerson | undefined) | undefined;
    today: ISODate;
    now: Date;
  },
): ReactNode {
  const words = riskWords(risk, context);
  const face = context.faceOf?.(riskPersonId(risk) ?? "");
  const key =
    "taskId" in risk
      ? `${risk.kind}-${risk.taskId}-${"memberId" in risk ? risk.memberId : ""}`
      : `${risk.kind}-${risk.memberId}`;
  return (
    <ListRow
      key={key}
      slot="risk-row"
      data={{ "data-kind": words.icon }}
      href={words.href}
      title={words.title}
      lead={face ? <PersonAvatar person={face} size={20} /> : undefined}
      meta={<span data-slot="risk-detail">{words.detail}</span>}
      chips={
        <StatusBadge
          status={words.icon}
          tone={words.tone}
          label={words.chip}
          className="whitespace-nowrap"
        />
      }
    />
  );
}

/** Whom a risk is about: the person whose photo leads its row. */
function riskPersonId(risk: Risk): string | null {
  switch (risk.kind) {
    case "overdue":
      return risk.ownerId;
    case "not_noted":
      return risk.waiting[0]?.memberId ?? null;
    case "on_leave":
    case "unreachable":
      return risk.memberId;
  }
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
  faceOf,
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
  /** Each person's photo, from the directory the page already read (#89). */
  faceOf?: (id: string) => AvatarPerson | undefined;
  today: ISODate;
  now: Date;
}) {
  const line = held ? heldEmailsLine(held) : null;
  if (risks.length === 0 && !line) return <>{empty}</>;
  const context = { nameOf, faceOf, today, now };
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
 * The Owner's "This week" (the Today refresh, owner 2026-10-09, in the detailed layout of his
 * final note): `weekBlocks`' day blocks, each a heading ("Today", "Wed 14 Oct") over its rows, a
 * time on the left ("All day", "11:49 am", "Due") and the words on the right, each row opening
 * its task (an event) or the calendar's day; "See the week" only when rows were left out. The
 * section's header carries "Calendar ›" (`CalendarHeaderLink`); no separate calendar card.
 */
export function WeekBlocks({ blocks, hidden }: { blocks: readonly WeekBlock[]; hidden: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-2" data-slot="week-blocks">
      <ul
        aria-label="The next 7 days"
        className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
      >
        {blocks.map((block) => (
          <li
            key={block.date}
            data-slot="week-day"
            data-date={block.date}
            className="flex flex-col"
          >
            <div className="flex min-h-9 items-center px-4 pt-2 text-xs font-semibold">
              <span data-slot="week-day-label">{block.label}</span>
            </div>
            <ul className="flex flex-col pb-1">
              {block.rows.map((row) => (
                <li key={row.key} data-slot="week-row" data-kind={row.kind}>
                  <WeekRowLink row={row} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <RowList label="The rest of the week">
          <LinkRow href={SEE_THE_WEEK_HREF} slot="today-see-the-week" title="See the week" tab />
        </RowList>
      ) : null}
    </div>
  );
}

/**
 * One row of a day: an event or a deadline drills into its task; the rest open the calendar
 * (another tab). A deadline carries a "Due" chip (PP-today-4); an event its place on a muted line.
 */
function WeekRowLink({ row }: { row: WeekRow }) {
  const content = (
    <>
      <span
        data-slot="week-row-when"
        className="text-muted-foreground w-16 shrink-0 text-xs tabular-nums"
      >
        {row.when}
      </span>
      <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
        <span data-slot="week-row-title" className="font-medium break-words">
          {row.title}
        </span>
        {row.detail ? (
          <span data-slot="week-row-detail" className="text-muted-foreground text-xs break-words">
            {row.detail}
          </span>
        ) : null}
      </span>
      {row.kind === "due" ? (
        <span className={CARD_ROW_TRAILING}>
          <StatusBadge status="due" tone="attention" label="Due" />
        </span>
      ) : null}
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </>
  );
  // `flex-wrap`, as every row with `CARD_ROW_TITLE`: at large system text the time, the title's
  // 6rem and the chevron no longer fit one line at 375px.
  const className =
    "focus-visible:ring-ring flex min-h-11 flex-wrap items-center gap-3 px-4 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset";
  return row.kind === "event" || row.kind === "due" ? (
    <DrillLink href={row.href} className={className}>
      {content}
    </DrillLink>
  ) : (
    <Link href={row.href} className={cn("pressable-row", className)}>
      {content}
    </Link>
  );
}

/**
 * "This week" as a section (FINAL 8, major change 1): the day blocks under the heading, with
 * "Calendar ›" beside it. Nothing at all when the week holds nothing (FINAL 1: an empty section
 * takes no heading).
 */
export function ThisWeek({
  blocks,
  hidden,
  slot = "today-events",
}: {
  blocks: readonly WeekBlock[];
  hidden: number;
  slot?: string;
}) {
  if (blocks.length === 0) return null;
  return (
    <DashSection title="This week" slot={slot} action={<CalendarHeaderLink />}>
      <WeekBlocks blocks={blocks} hidden={hidden} />
    </DashSection>
  );
}

/**
 * Today's and My Day's two columns (major change 1, FINAL 8): the main column, then "This week".
 * A container query on the content width: **two columns from 896 px (56rem)** (owner 23 Oct, #89
 * comment 6370526089: a 1280 px laptop, whose content is about 960 px wide, shows the column;
 * the 1024 px asked for is wider than that), "This week" at most 30%
 * (`minmax(260px, 30%)`); below that one column, "This week" under the rest (under
 * "Overdue and risks"), full width, never squeezed and never hidden.
 */
export function DayColumns({
  main,
  week,
  slot = "day-main",
  loading,
  laptopOnly = false,
}: {
  main: ReactNode;
  week: ReactNode;
  /** The main column's `data-slot` ("owner-today"), for the screen's specs. */
  slot?: string;
  /** A loading screen's name ("Loading Today"): the main column is its busy status. */
  loading?: string;
  /**
   * "This week" only from the `md` breakpoint (the Tasks tab's "My tasks", PP-crew-7): the phone
   * keeps its one list, with nothing under it; My Day and Today show it on every width.
   */
  laptopOnly?: boolean;
}) {
  return (
    <div className="@container min-w-0" data-slot="day-columns">
      <div className="flex min-w-0 flex-col gap-6 @min-[56rem]:grid @min-[56rem]:grid-cols-[minmax(0,1fr)_minmax(260px,30%)] @min-[56rem]:items-start @min-[56rem]:gap-8">
        <div
          className="flex min-w-0 flex-col gap-6"
          data-slot={slot}
          {...(loading ? { role: "status", "aria-busy": true, "aria-label": loading } : {})}
        >
          {main}
        </div>
        {week ? (
          <aside
            aria-label="This week"
            className={cn("min-w-0", laptopOnly && "hidden md:block")}
            data-slot="day-week"
          >
            {week}
          </aside>
        ) : null}
      </div>
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

/** "This week" while the page loads: its heading with "Calendar ›", then two day blocks. */
export function ThisWeekSkeleton() {
  return (
    <div aria-hidden className="flex min-w-0 flex-col gap-2" data-slot="loading-this-week">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
      <ul className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border">
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
    </div>
  );
}
