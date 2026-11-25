import Link from "next/link";
import type { ReactNode } from "react";

import { Skeleton } from "@/core/ui/primitives/skeleton";

import {
  type ClientWorkFacts,
  clientLines,
  type DelayFact,
  type DelayGroup,
  delayCountWords,
  delayWords,
  type FactLine,
  type PersonRow,
  personLines,
  type StageFact,
  type StageProject,
  stageWords,
} from "../domain/owner-reports";

/**
 * The Owner's reports' blocks (v3.0, 9.3): cards, never tables, at every width (ARCHITECTURE
 * §14.1: cards instead of tables), one column on a phone and two from `md`. Nothing is ranked,
 * scored or coloured (PRODUCT §2 principle 10): every fact is plain text in the same weight. Each
 * block has a skeleton built from the same classes, so nothing moves when the data arrives.
 * Server components: a report is read, not edited.
 */

export const CARD_CLASS = "border-border bg-card flex min-w-0 flex-col gap-3 rounded-lg border p-4";
export const CARD_GRID_CLASS = "grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2";
const FACTS_CLASS = "grid grid-cols-2 gap-x-4 gap-y-2";
const FACT_LABEL_CLASS = "text-muted-foreground text-xs";
const FACT_VALUE_CLASS = "text-sm tabular-nums";

/** A card's facts: label over value, two to a row. */
function Facts({ lines, slot }: { lines: readonly FactLine[]; slot: string }) {
  return (
    <dl className={FACTS_CLASS} data-slot={slot}>
      {lines.map((line) => (
        <div key={line.key} className="flex min-w-0 flex-col" data-fact={line.key}>
          <dt className={FACT_LABEL_CLASS}>{line.label}</dt>
          <dd className={FACT_VALUE_CLASS}>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FactsSkeleton({ count }: { count: number }) {
  return (
    <div className={FACTS_CLASS} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex min-w-0 flex-col">
          <span className="flex h-4 items-center">
            <Skeleton className="h-3 w-20" />
          </span>
          <span className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-16" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** A section's heading, the same height loaded or not. */
export function ReportHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="flex h-5 items-center text-sm font-semibold">
      {children}
    </h2>
  );
}

export function ReportHeadingSkeleton({ width = "w-28" }: { width?: string }) {
  return (
    <div className="flex h-5 items-center" aria-hidden>
      <Skeleton className={`h-4 ${width}`} />
    </div>
  );
}

// People ------------------------------------------------------------------------------------------

/**
 * One person's card: their name, the task facts (always all seven, in a fixed order) and, in the
 * Month view only (Q5), their attendance lines and working-hours counts (`attendance`).
 */
export function PersonCard({ row, attendance }: { row: PersonRow; attendance?: ReactNode }) {
  return (
    <section
      className={CARD_CLASS}
      data-slot="person-card"
      data-member={row.memberId}
      aria-label={row.fullName}
    >
      <h3 className="truncate text-sm font-semibold">{row.fullName}</h3>
      <Facts lines={personLines(row)} slot="person-facts" />
      {attendance ?? null}
    </section>
  );
}

export const PERSON_FACT_COUNT = 7;

/** `attendance`: the Month view's attendance facts (their count), else none. */
export function PersonCardSkeleton({ attendance = 0 }: { attendance?: number }) {
  return (
    <div className={CARD_CLASS} aria-hidden data-slot="person-card-skeleton">
      <span className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-32" />
      </span>
      <FactsSkeleton count={PERSON_FACT_COUNT} />
      {attendance > 0 ? (
        <div className="border-border flex flex-col gap-2 border-t pt-3">
          <FactsSkeleton count={attendance} />
        </div>
      ) : null}
    </div>
  );
}

/** A person's attendance facts (the Month view only), in the card's own fact layout. */
export function AttendanceFacts({ lines }: { lines: readonly FactLine[] }) {
  return (
    <div className="border-border flex flex-col gap-2 border-t pt-3">
      <Facts lines={lines} slot="person-attendance" />
    </div>
  );
}

// Delays ------------------------------------------------------------------------------------------

function GroupList({ title, groups, slot }: { title: string; groups: DelayGroup[]; slot: string }) {
  return (
    <section className={CARD_CLASS} data-slot={slot} aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {groups.map((group) => (
          <li key={group.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{group.label}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {delayCountWords(group.count)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How many late tasks the list shows; the patterns above it count every one. */
export const DELAY_LIST_LIMIT = 30;

/**
 * The delay patterns (decision 14): the late tasks by person (by name), by type and by client
 * label, then the tasks themselves (the first `DELAY_LIST_LIMIT` by deadline) with the primary
 * owner's late reason. A row opens its task.
 */
export function DelayReport({
  patterns,
  facts,
  nameOf,
  now,
}: {
  patterns: { byType: DelayGroup[]; byClient: DelayGroup[]; byPerson: DelayGroup[] };
  facts: readonly DelayFact[];
  nameOf: (memberId: string) => string;
  now: Date;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3" data-slot="delay-report">
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        <GroupList title="By person" groups={patterns.byPerson} slot="delays-by-person" />
        <GroupList title="By type" groups={patterns.byType} slot="delays-by-type" />
        <GroupList title="By client label" groups={patterns.byClient} slot="delays-by-client" />
      </div>
      <ul
        className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
        data-slot="delay-list"
      >
        {facts.slice(0, DELAY_LIST_LIMIT).map((fact) => (
          <li key={fact.taskId}>
            <Link
              href={`/tasks/${fact.taskId}`}
              className="pressable-row focus-visible:ring-ring flex min-h-14 flex-col gap-0.5 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset"
              data-slot="delay-row"
            >
              <span className="truncate text-sm font-medium">{fact.title}</span>
              <span className="text-muted-foreground text-sm">
                {nameOf(fact.primaryOwnerId)} · {delayWords(fact, now)}
              </span>
              <span className="text-muted-foreground text-sm break-words">
                {fact.lateReason ? `Reason: ${fact.lateReason}` : "No reason given"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {facts.length > DELAY_LIST_LIMIT ? (
        <p className="text-muted-foreground text-sm" data-slot="delay-list-more">
          Showing the first {DELAY_LIST_LIMIT} of {facts.length} by deadline. Choose a shorter
          period to see the rest.
        </p>
      ) : null}
    </div>
  );
}

export function DelayReportSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3" aria-hidden>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div key={card} className={CARD_CLASS}>
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-24" />
            </span>
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-full" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Stage durations ---------------------------------------------------------------------------------

function StageRows({ stages }: { stages: readonly StageFact[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {stages.map((stage) => (
        <li
          key={`${stage.projectId ?? "all"}:${stage.stageKey}`}
          className="flex min-w-0 flex-col"
          data-slot="stage-row"
          data-stage={stage.stageKey}
        >
          <span className="truncate text-sm font-medium">{stage.stageName}</span>
          <span className="text-muted-foreground text-sm tabular-nums">{stageWords(stage)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Across every project (R7: by stage name, ignoring case), slowest first. */
export function StageOverall({ stages }: { stages: readonly StageFact[] }) {
  return (
    <section className={CARD_CLASS} data-slot="stages-overall" aria-label="Every project">
      <StageRows stages={stages} />
    </section>
  );
}

/** One project's stages, slowest first. */
export function StageProjectCard({ project }: { project: StageProject }) {
  return (
    <section
      className={CARD_CLASS}
      data-slot="stages-project"
      aria-label={`${project.clientName} · ${project.projectName}`}
    >
      <h3 className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{project.projectName}</span>
        <span className="text-muted-foreground truncate text-xs">{project.clientName}</span>
      </h3>
      <StageRows stages={project.stages} />
    </section>
  );
}

export function StageCardSkeleton({ rows = 3, title = false }: { rows?: number; title?: boolean }) {
  return (
    <div className={CARD_CLASS} aria-hidden>
      {title ? (
        <span className="flex flex-col">
          <span className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-36" />
          </span>
          <span className="flex h-4 items-center">
            <Skeleton className="h-3 w-24" />
          </span>
        </span>
      ) : null}
      <span className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <span key={index} className="flex flex-col">
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-24" />
            </span>
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-56 max-w-full" />
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

// Client work -------------------------------------------------------------------------------------

/**
 * One client's deliverables for the period. `revenue` is the seam for the Owner's money line
 * (v2.1): filled only by the page, only through `modules/revenue`, only for `finance.view`; this
 * module never reads or carries money (invariant 2).
 */
export function ClientWorkCard({ row, revenue }: { row: ClientWorkFacts; revenue?: ReactNode }) {
  return (
    <section
      className={CARD_CLASS}
      data-slot="client-work-card"
      data-client={row.clientId}
      aria-label={row.clientName}
    >
      <h3 className="truncate text-sm font-semibold">
        {row.clientId ? (
          <Link
            href={`/clients/${row.clientId}`}
            className="pressable focus-visible:ring-ring -my-3 flex min-h-11 items-center rounded-sm outline-none hover:underline focus-visible:ring-2"
          >
            {row.clientName}
          </Link>
        ) : (
          row.clientName
        )}
      </h3>
      <Facts lines={clientLines(row)} slot="client-work-facts" />
      {revenue ?? null}
    </section>
  );
}

export const CLIENT_FACT_COUNT = 6;

export function ClientWorkCardSkeleton() {
  return (
    <div className={CARD_CLASS} aria-hidden data-slot="client-work-card-skeleton">
      <span className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-32" />
      </span>
      <FactsSkeleton count={CLIENT_FACT_COUNT} />
    </div>
  );
}
