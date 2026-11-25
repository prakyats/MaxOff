import { formatIST } from "@/core/time";

import { ENGAGEMENTS, type Engagement, hoursWords, type Split } from "./work-report";

/**
 * The Owner's reports (v3.0, task 9.3; PRODUCT §4.13; kickoff 9 decisions 12–14, the 14 Nov
 * refresh's R7 and Q5): People, Stage durations and Client work. The facts are counted in the
 * database (`report_people`, `report_task_delays`, `report_stage_durations`, `report_client_work`,
 * the Owner's alone); this file only shapes them and words them. **Raw facts, never a score**
 * (PRODUCT §2 principle 10): people are listed by name, never ranked or coloured, and freelancers
 * stand apart (ADR-0013). Never money: a client's revenue joins only through `modules/revenue`
 * (invariant 2), outside this module.
 */

// People ------------------------------------------------------------------------------------------

/** One person's task facts for the period (`report_people`). */
export type PersonFacts = {
  memberId: string;
  /** Owner-approved tasks completed in the period, counted for every active assignee. */
  completed: number;
  /** Of the tasks they own (primary owner) completed in the period, those first handed in by the deadline. */
  onTime: number;
  ownedCompleted: number;
  /** Send-backs on the tasks they completed in the period. */
  revisionLoops: number;
  /** Median hours from assignment to the first hand-in, on the tasks they own; null: none. */
  handInHours: number | null;
  /** Median hours from assignment to "Task Noted", notes tapped in the period; null: none. */
  ackLagHours: number | null;
  openNow: number;
  overdueNow: number;
};

export type Person = { id: string; fullName: string; engagement: Engagement };

export type PersonRow = PersonFacts & { fullName: string; engagement: Engagement };

/** Whether a row has anything to say: a person with no task at all in or around the period. */
function quiet(row: PersonFacts): boolean {
  return (
    row.completed === 0 &&
    row.ownedCompleted === 0 &&
    row.openNow === 0 &&
    row.ackLagHours === null &&
    row.handInHours === null
  );
}

/**
 * The people report's rows, split by engagement and **sorted by name** (decision 13: nothing
 * ranked). A person the directory doesn't know (left the organization) keeps their facts under
 * "Someone". With `withQuiet` false the people with nothing in the period fold away (the page
 * names how many).
 */
export function peopleRows(
  facts: readonly PersonFacts[],
  people: readonly Person[],
): { rows: Split<PersonRow[]>; quiet: Split<PersonRow[]> } {
  const byId = new Map(people.map((person) => [person.id, person]));
  const rows: Split<PersonRow[]> = { permanent: [], freelance: [] };
  const still: Split<PersonRow[]> = { permanent: [], freelance: [] };
  for (const fact of facts) {
    const person = byId.get(fact.memberId);
    const row: PersonRow = {
      ...fact,
      fullName: person?.fullName ?? "Someone",
      engagement: person?.engagement ?? "permanent",
    };
    (quiet(row) ? still : rows)[row.engagement].push(row);
  }
  for (const engagement of ENGAGEMENTS) {
    for (const list of [rows[engagement], still[engagement]]) {
      list.sort(
        (a, b) => a.fullName.localeCompare(b.fullName) || a.memberId.localeCompare(b.memberId),
      );
    }
  }
  return { rows, quiet: still };
}

/** One labelled fact of a person's card, in the report's fixed order. */
export type FactLine = { key: string; label: string; value: string };

/** "1 task", "3 tasks". */
function tasks(count: number): string {
  return count === 1 ? "1 task" : `${count} tasks`;
}

/** A person's facts as the card shows them, always in this order and always all of them. */
export function personLines(row: PersonFacts): FactLine[] {
  return [
    { key: "completed", label: "Completed", value: tasks(row.completed) },
    {
      key: "on-time",
      label: "On time",
      value:
        row.ownedCompleted === 0 ? "None of their own" : `${row.onTime} of ${row.ownedCompleted}`,
    },
    {
      key: "loops",
      label: "Revision loops",
      value: row.revisionLoops === 0 ? "None" : sendBacks(row.revisionLoops),
    },
    { key: "hand-in", label: "To first hand-in", value: medianWords(row.handInHours) },
    { key: "ack", label: "Acknowledgement lag", value: medianWords(row.ackLagHours) },
    { key: "open", label: "Open now", value: tasks(row.openNow) },
    { key: "overdue", label: "Overdue now", value: tasks(row.overdueNow) },
  ];
}

function sendBacks(count: number): string {
  return count === 1 ? "1 send-back" : `${count} send-backs`;
}

/** "Median 3.5 h", "No data". */
export function medianWords(hours: number | null): string {
  return hours === null ? "No data" : `Median ${hoursWords(hours)}`;
}

// Delays ------------------------------------------------------------------------------------------

/** A task due in the period that was handed in late or is still past its deadline. */
export type DelayFact = {
  taskId: string;
  title: string;
  primaryOwnerId: string;
  typeName: string | null;
  clientName: string | null;
  dueAt: string;
  handedInAt: string | null;
  open: boolean;
  lateReason: string | null;
};

export type DelayGroup = { key: string; label: string; count: number };

function groupBy(
  facts: readonly DelayFact[],
  keyOf: (fact: DelayFact) => string,
  labelOf: (fact: DelayFact) => string,
): DelayGroup[] {
  const groups = new Map<string, DelayGroup>();
  for (const fact of facts) {
    const key = keyOf(fact);
    const group = groups.get(key) ?? { key, label: labelOf(fact), count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * The delay patterns (decision 14): the late tasks counted by type and by client label (most
 * first: a pattern, not a person) and **by person, by name** (never a ranking of people).
 */
export function delayPatterns(
  facts: readonly DelayFact[],
  nameOf: (memberId: string) => string,
): { byType: DelayGroup[]; byClient: DelayGroup[]; byPerson: DelayGroup[] } {
  const mostFirst = (a: DelayGroup, b: DelayGroup) =>
    b.count - a.count || a.label.localeCompare(b.label);
  return {
    byType: groupBy(
      facts,
      (fact) => fact.typeName ?? "",
      (fact) => fact.typeName ?? "No type",
    ).sort(mostFirst),
    byClient: groupBy(
      facts,
      (fact) => fact.clientName ?? "",
      (fact) => fact.clientName ?? "No client label",
    ).sort(mostFirst),
    byPerson: groupBy(
      facts,
      (fact) => fact.primaryOwnerId,
      (fact) => nameOf(fact.primaryOwnerId),
    ).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

const DAY_MS = 86_400_000;

/** "Due 5 Mar · handed in 2 days late", "Due 20 Mar · still open, 3 days past". */
export function delayWords(fact: DelayFact, now: Date): string {
  const due = `Due ${formatIST(new Date(fact.dueAt), "d MMM")}`;
  const until = fact.handedInAt ? Date.parse(fact.handedInAt) : now.getTime();
  const days = Math.max(1, Math.round((until - Date.parse(fact.dueAt)) / DAY_MS));
  const span = days === 1 ? "1 day" : `${days} days`;
  return fact.handedInAt ? `${due} · handed in ${span} late` : `${due} · still open, ${span} past`;
}

/** "2 tasks", for a group's count. */
export function delayCountWords(count: number): string {
  return tasks(count);
}

// Stage durations (R7) ----------------------------------------------------------------------------

/** One stage name's durations: overall (`projectId` null) or in one project. */
export type StageFact = {
  projectId: string | null;
  projectName: string | null;
  clientName: string | null;
  stageKey: string;
  stageName: string;
  ticks: number;
  medianDays: number;
  longestDays: number;
};

export type StageProject = {
  projectId: string;
  projectName: string;
  clientName: string;
  stages: StageFact[];
};

/**
 * The stage durations (R7: grouped by stage name, ignoring case; groups and revision rounds are
 * just stages): the overall list across projects, **slowest first**, and each project's own,
 * slowest first, the projects by client then name.
 */
export function stageReport(facts: readonly StageFact[]): {
  overall: StageFact[];
  projects: StageProject[];
} {
  const slowest = (a: StageFact, b: StageFact) =>
    b.medianDays - a.medianDays || b.ticks - a.ticks || a.stageKey.localeCompare(b.stageKey);
  const overall = facts.filter((fact) => fact.projectId === null).sort(slowest);
  const projects = new Map<string, StageProject>();
  for (const fact of facts) {
    if (fact.projectId === null) continue;
    const project = projects.get(fact.projectId) ?? {
      projectId: fact.projectId,
      projectName: fact.projectName ?? "A project",
      clientName: fact.clientName ?? "",
      stages: [],
    };
    project.stages.push(fact);
    projects.set(fact.projectId, project);
  }
  const list = [...projects.values()];
  for (const project of list) project.stages.sort(slowest);
  list.sort(
    (a, b) =>
      a.clientName.localeCompare(b.clientName) ||
      a.projectName.localeCompare(b.projectName) ||
      a.projectId.localeCompare(b.projectId),
  );
  return { overall, projects: list };
}

/** "2.5 days", "1 day", "under an hour" (≈ 0; it follows "Median" or "longest"). */
export function daysWords(days: number): string {
  if (days < 1 / 24) return "under an hour";
  if (days < 1) {
    const hours = Math.round(days * 24);
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  const rounded = Math.round(days * 10) / 10;
  return rounded === 1 ? "1 day" : `${rounded} days`;
}

/** "Median 3 days · longest 8 days · 12 done". */
export function stageWords(fact: Pick<StageFact, "medianDays" | "longestDays" | "ticks">): string {
  return `Median ${daysWords(fact.medianDays)} · longest ${daysWords(fact.longestDays)} · ${fact.ticks} done`;
}

// Client work ---------------------------------------------------------------------------------------

/** One client's deliverables for the period (`report_client_work`). Counts only: never money. */
export type ClientWorkFacts = {
  clientId: string;
  clientName: string;
  planned: number;
  done: number;
  doneOnTime: number;
  doneInPeriod: number;
  overdueNow: number;
  onHold: number;
  projectsCompleted: number;
};

function deliverables(count: number): string {
  return count === 1 ? "1 deliverable" : `${count} deliverables`;
}

/** A client's lines, in the report's fixed order. */
export function clientLines(row: ClientWorkFacts): FactLine[] {
  return [
    {
      key: "planned",
      label: "Planned in the period",
      value: row.planned === 0 ? "Nothing planned" : `${row.done} of ${row.planned} done`,
    },
    {
      key: "on-time",
      label: "On time",
      value: row.planned === 0 ? "—" : `${row.doneOnTime} of ${row.planned}`,
    },
    { key: "done", label: "Done in the period", value: deliverables(row.doneInPeriod) },
    { key: "overdue", label: "Overdue now", value: deliverables(row.overdueNow) },
    { key: "held", label: "On hold now", value: deliverables(row.onHold) },
    {
      key: "projects",
      label: "Projects completed",
      value: row.projectsCompleted === 1 ? "1 project" : `${row.projectsCompleted} projects`,
    },
  ];
}

/** The totals across clients, for the line above the list. */
export function clientTotals(rows: readonly ClientWorkFacts[]): ClientWorkFacts {
  const total: ClientWorkFacts = {
    clientId: "",
    clientName: "All clients",
    planned: 0,
    done: 0,
    doneOnTime: 0,
    doneInPeriod: 0,
    overdueNow: 0,
    onHold: 0,
    projectsCompleted: 0,
  };
  for (const row of rows) {
    total.planned += row.planned;
    total.done += row.done;
    total.doneOnTime += row.doneOnTime;
    total.doneInPeriod += row.doneInPeriod;
    total.overdueNow += row.overdueNow;
    total.onHold += row.onHold;
    total.projectsCompleted += row.projectsCompleted;
  }
  return total;
}
