import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { cn } from "@/core/lib/utils";
import { systemClock, type ISODate } from "@/core/time";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { buildCrew, TEAM_FIRST_LINES, teamToday, type TeamLine } from "@/modules/calendar";

import { readDirectory } from "../tasks/reads";

import { readTeamAvailability } from "./reads";

/**
 * No type colour on Today (the approved sample draws none, and the card reads no task types); the
 * People page's Today column has the dot.
 */
const NO_COLOR = "";

/**
 * The Team today card (v6.5 unit 10; owner 14 Nov 2026, #89 6874350719 and 6874389662; the approved
 * sample "2 · Admin Today: Team today card"), for the Owner and Admins (`availability.view`): free
 * now, booked today and on leave, then one line per person, booked first. From
 * `member_availability()` only, never attendance times. "Show all N" opens in place (a native
 * disclosure: no history, no JavaScript); "+ Book someone free" and "Calendar ›" open Calendar → Day
 * for today, whose Crew card lists who is free and starts New task for that day (Q5, the plan's
 * alternative: no form setup read on Today, the speed gate). A server component in its own
 * Suspense boundary, drawn twice by the page (after Needs you on a phone, beside it on a laptop).
 */
export async function TeamToday({
  viewerId,
  today,
  slot,
}: {
  viewerId: string;
  today: ISODate;
  slot: string;
}) {
  const [availability, directory] = await Promise.all([
    readTeamAvailability(today),
    readDirectory(),
  ]);
  const owner = directory.find((member) => member.role === "owner" && member.status === "active");
  const crew = buildCrew({
    // The Owner reads member_availability() too (6b.2): one path for both, the Admin's.
    scope: "admin",
    viewerId,
    owner: owner ? { id: owner.id, name: owner.fullName } : null,
    people: directory
      .filter((member) => member.status === "active" && member.role !== "owner")
      .map((member) => ({
        id: member.id,
        name:
          member.engagement === "freelance" ? `${member.fullName} (freelancer)` : member.fullName,
      })),
    types: [],
    nameOf: (memberId) => directory.find((member) => member.id === memberId)?.fullName ?? null,
    fallbackColor: NO_COLOR,
    events: [],
    leave: [],
    availability,
  });
  if (!crew) return null;
  const team = teamToday(crew, today, systemClock());
  const first = team.lines.slice(0, TEAM_FIRST_LINES);
  const rest = team.lines.slice(TEAM_FIRST_LINES);
  const dayHref = `/calendar?view=day&date=${today}`;
  const titleId = `${slot}-title`;

  return (
    <section
      aria-labelledby={titleId}
      data-slot={slot}
      className="border-border bg-card shadow-raised flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex min-h-5 items-center justify-between gap-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Team today
        </h2>
        <Link
          href={dayHref}
          data-slot="team-today-calendar"
          className="pressable focus-visible:ring-ring text-muted-foreground hover:text-foreground -my-3 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2"
        >
          Calendar
          <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
        </Link>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center" data-slot="team-today-counts">
        <Count label="Free now" value={team.freeNow} slot="free-now" />
        <Count label="Booked today" value={team.bookedToday} slot="booked-today" />
        <Count label="On leave" value={team.onLeave} slot="on-leave" />
      </dl>
      {team.lines.length > 0 ? (
        <div className="flex min-w-0 flex-col">
          <ul aria-label="Who is on what today" className="divide-border flex flex-col divide-y">
            {first.map((line) => (
              <Line key={line.memberId} line={line} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="group" data-slot="team-today-more">
              <summary className="pressable focus-visible:ring-ring text-muted-foreground hover:text-foreground flex min-h-11 cursor-pointer list-none items-center justify-center rounded-md text-sm font-medium outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show all {team.lines.length}</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ul className="divide-border border-border flex flex-col divide-y border-t">
                {rest.map((line) => (
                  <Line key={line.memberId} line={line} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      <Link
        href={dayHref}
        data-slot="team-today-book"
        className="pressable border-border focus-visible:ring-ring hover:bg-accent flex min-h-11 items-center justify-center rounded-md border text-sm font-medium outline-none focus-visible:ring-2"
      >
        + Book someone free
      </Link>
    </section>
  );
}

function Count({ label, value, slot }: { label: string; value: number; slot: string }) {
  return (
    <div className="bg-muted flex flex-col rounded-md py-2" data-slot={`team-today-${slot}`}>
      <dd className="order-1 text-xl font-semibold tabular-nums">{value}</dd>
      <dt className="text-muted-foreground order-2 text-xs">{label}</dt>
    </div>
  );
}

function Line({ line }: { line: TeamLine }) {
  const detail =
    [line.text, line.by].filter(Boolean).join(" · ") + (line.more > 0 ? ` +${line.more}` : "");
  return (
    <li
      data-slot="team-today-line"
      data-kind={line.kind}
      className="flex min-h-11 min-w-0 items-center justify-between gap-3 py-2 text-sm"
    >
      {/*
        One line per person, always 44 px, so the skeleton traces it (§14.1): the name gives way
        first (cut at 45%), then the booking ("…"); the whole of it stays in the title.
      */}
      <span className="block max-w-[45%] min-w-0 shrink-0 truncate font-medium">{line.name}</span>
      <span
        title={detail}
        className={cn(
          "block min-w-0 flex-1 truncate text-right",
          line.kind === "free" ? "text-success" : "text-muted-foreground",
        )}
      >
        {detail}
      </span>
    </li>
  );
}

/**
 * Where the page puts the card: `narrow` in the main column under 56rem (after Needs you), else in
 * "This week"'s column from 56rem (`DayColumns`' container query). Both copies render on the
 * server and the read is cached, so it runs once; each streams in its own boundary.
 */
export function TeamTodayColumn({
  viewerId,
  today,
  narrow = false,
}: {
  viewerId: string;
  today: ISODate;
  narrow?: boolean;
}) {
  const slot = narrow ? "team-today-narrow" : "team-today";
  return (
    <div className={narrow ? "@min-[56rem]:hidden" : "hidden @min-[56rem]:block"}>
      <Suspense fallback={<TeamTodaySkeleton slot={slot} />}>
        <TeamToday viewerId={viewerId} today={today} slot={slot} />
      </Suspense>
    </div>
  );
}

/**
 * The card as it loads (ARCHITECTURE §14.1): the heading, three tiles, five lines, "Show all N" and
 * the link.
 */
export function TeamTodaySkeleton({ slot }: { slot: string }) {
  return (
    <div
      aria-hidden
      data-slot={`loading-${slot}`}
      className="border-border bg-card shadow-raised flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex min-h-5 items-center justify-between gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((tile) => (
          <div
            key={tile}
            className="bg-muted flex h-[3.75rem] flex-col items-center justify-center gap-1.5 rounded-md"
          >
            <Skeleton className="h-5 w-6" />
            <Skeleton className="h-3 w-16 max-w-full" />
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="divide-border flex flex-col divide-y">
          {Array.from({ length: TEAM_FIRST_LINES }, (_, index) => (
            <div key={index} className="flex min-h-11 items-center justify-between gap-3 py-2">
              <Skeleton className="h-4 w-24 max-w-[40%]" />
              <Skeleton className="h-4 w-32 max-w-[50%]" />
            </div>
          ))}
        </div>
        {/* "Show all N", under the lines: the studio's team is always more than five people. */}
        <div className="flex min-h-11 items-center justify-center">
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="h-11 w-full rounded-md" />
    </div>
  );
}
