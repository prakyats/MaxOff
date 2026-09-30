import { formatIST } from "@/core/time";

import { pairName } from "./task";
import { PRIORITY_LABELS, type Priority } from "./types";

/**
 * A task's change history (4.4, PRODUCT §4.14): each audit entry about the task and its children
 * (all written with `entity_id` = the task, 4A) as one sentence, "Ravi for Asha noted the task"
 * (ADR-0013: the pair wherever a person is named). Pure, so the wording is unit-tested. Comments
 * have their own timeline and are left out here, as are the rows that only echo another entry
 * (the review row beside its decision, a submission beside its Done, the half of a primary change
 * that clears the old flag).
 */

/** An audit entry as `core/activity` reads it (structurally; ADR-0011 keeps domain free of it). */
export type TaskActivityEntry = {
  id: number;
  actorId: string | null;
  onBehalfOfId: string | null;
  entity: string;
  action: string;
  old: Record<string, unknown>;
  new: Record<string, unknown>;
  meta: Record<string, unknown>;
  at: string;
};

export type TaskActivityContext = {
  names: Readonly<Record<string, string>>;
  types: Readonly<Record<string, string>>;
  clients: Readonly<Record<string, string>>;
  /**
   * The ticked stages by the instant of their tick (epoch ms → name). A tick's audit row holds
   * only the columns it changed (`done_at`, `done_by`, `on_behalf_of`), so the stage is named
   * when it is still ticked from that moment; otherwise the line says "a stage".
   */
  tickedStages?: Readonly<Record<number, string>>;
};

export type TaskHistoryLine = {
  id: number;
  at: string;
  /** "Ravi", or "Ravi for Asha" when a coordinator acted for a freelancer. */
  actor: string;
  /** Who acted, by id ("<actor>|<for>"): consecutive ticks by the same pair collapse (29). */
  actorKey: string;
  text: string;
  /** A second line: a reason (late, changes requested, cancel, reopen). */
  note?: string;
  /** A stage tick or untick: which way, and the stage when it is known. */
  tick?: StageTick;
  /** How many entries the line stands for: more than one when ticks collapsed into it. */
  count?: number;
};

/** A stage tick (`done`) or untick, and the stage's name when the history can tell it. */
export type StageTick = { done: boolean; stage: string | null };

const WARNING_TEXT: Record<string, string> = {
  workload: "a heavy day",
  overlap: "an overlapping event",
  on_leave: "leave that day",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function quoted(value: unknown): string {
  return `“${text(value) ?? ""}”`;
}

function when(value: unknown): string | null {
  return typeof value === "string" && value ? formatIST(value, "d MMM, h:mm a") : null;
}

function day(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatIST(`${value}T12:00:00+05:30`, "d MMM")
    : null;
}

function nameOf(context: TaskActivityContext, id: unknown): string {
  return typeof id === "string" ? (context.names[id] ?? "someone") : "someone";
}

/** "changed the deadline from 1 Oct, 6:00 pm to 2 Oct, 6:00 pm" and friends, for one field. */
function fieldClause(
  field: string,
  before: unknown,
  after: unknown,
  context: TaskActivityContext,
): string | null {
  switch (field) {
    case "title":
      return `renamed the task to ${quoted(after)}`;
    case "description":
      return text(after) ? "changed the description" : "removed the description";
    case "task_type_id":
      return `changed the type to ${typeof after === "string" ? (context.types[after] ?? "another type") : "another type"}`;
    case "client_id":
      return typeof after === "string"
        ? `labelled it ${context.clients[after] ?? "with another client"}`
        : "removed the client label";
    case "priority": {
      const label = (value: unknown) =>
        typeof value === "string" && value in PRIORITY_LABELS
          ? PRIORITY_LABELS[value as Priority]
          : "?";
      return `changed the priority from ${label(before)} to ${label(after)}`;
    }
    case "due_at":
      return `moved the deadline from ${when(before) ?? "?"} to ${when(after) ?? "?"}`;
    case "event_date":
      return day(after) ? `moved the event to ${day(after)}` : "removed the event date";
    case "event_start_at":
    case "event_end_at":
      return "changed the event time";
    case "location":
      return text(after) ? `set the location to ${quoted(after)}` : "removed the location";
    case "purpose":
      return text(after) ? "changed the purpose" : "removed the purpose";
    case "custom_fields":
      return "changed the task's fields";
    case "reminder_rules":
      return "changed the reminders";
    default:
      return null;
  }
}

function joinClauses(clauses: readonly string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? "";
  return `${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1)}`;
}

function describe(
  entry: TaskActivityEntry,
  context: TaskActivityContext,
): { text: string; note?: string; tick?: StageTick } | null {
  const meta = entry.meta;
  switch (entry.entity) {
    case "tasks":
      switch (entry.action) {
        case "created":
          return { text: "created the task" };
        case "started":
          return { text: "started work" };
        case "submitted": {
          const late = meta.late === true;
          const step = meta.admin_step;
          const route =
            step === "skipped"
              ? " (no Admin check: the approver is on the task)"
              : step === "none"
                ? ""
                : "";
          const reason = late ? text(entry.new.late_reason) : null;
          return {
            text: `${meta.version === 1 || meta.version === undefined ? "marked it done" : "marked it done again"}${late ? " after the deadline" : ""}${route}`,
            ...(reason ? { note: `Late: ${reason}` } : {}),
          };
        }
        case "admin_approved":
          return { text: "checked it and passed it to the Owner" };
        case "completed":
          return { text: "approved it: the task is complete" };
        case "changes_requested": {
          const reason = text(meta.reason);
          return { text: "asked for changes", ...(reason ? { note: reason } : {}) };
        }
        case "reopened": {
          const reason = text(meta.reason);
          return { text: "reopened the task", ...(reason ? { note: reason } : {}) };
        }
        case "cancelled": {
          const reason = text(meta.reason);
          return { text: "cancelled the task", ...(reason ? { note: reason } : {}) };
        }
        case "approver_changed": {
          const from = typeof meta.from === "string" ? meta.from : null;
          const to = typeof meta.to === "string" ? meta.to : null;
          if (!to)
            return {
              text: `removed ${from ? nameOf(context, from) : "the approver"} as approver: the Owner decides`,
            };
          return { text: `made ${nameOf(context, to)} the approver` };
        }
        case "updated": {
          const fields = Array.isArray(meta.fields)
            ? meta.fields.filter((field): field is string => typeof field === "string")
            : Object.keys(entry.new);
          const clauses = fields
            .filter((field) => field in entry.new || field in entry.old)
            .map((field) => fieldClause(field, entry.old[field], entry.new[field], context))
            .filter((clause): clause is string => clause !== null);
          const unique = clauses.filter((clause, index) => clauses.indexOf(clause) === index);
          return unique.length > 0 ? { text: joinClauses(unique) } : null;
        }
        default:
          return null;
      }
    case "task_assignees":
      switch (entry.action) {
        case "assigned": {
          const who = nameOf(context, meta.member_id);
          const again = meta.again === true ? " again" : "";
          return {
            text: `assigned ${who}${again}${meta.is_primary === true ? " as the primary owner" : ""}`,
          };
        }
        case "unassigned":
          return { text: `took ${nameOf(context, meta.member_id)} off the task` };
        case "primary_changed":
          // Two rows: one clears the old flag, one sets the new; describe the second.
          return entry.new.is_primary === true
            ? { text: `made ${nameOf(context, meta.to)} the primary owner` }
            : null;
        case "acknowledged":
          return { text: meta.implied === true ? "noted the task (with Done)" : "noted the task" };
        default:
          return null;
      }
    case "task_stages":
      switch (entry.action) {
        case "stage_added":
          return { text: `added the stage ${quoted(meta.name)}` };
        case "insert":
          return { text: `added the stage ${quoted(entry.new.name)}` };
        case "delete":
          return { text: `removed the stage ${quoted(entry.old.name)}` };
        case "update": {
          if ("done_at" in entry.new) {
            const at = typeof entry.new.done_at === "string" ? Date.parse(entry.new.done_at) : NaN;
            if (Number.isNaN(at)) {
              return { text: "unticked a stage", tick: { done: false, stage: null } };
            }
            const name = context.tickedStages?.[at] ?? null;
            return {
              text: name ? `ticked ${quoted(name)}` : "ticked a stage",
              tick: { done: true, stage: name },
            };
          }
          if ("name" in entry.new) {
            return {
              text: `renamed the stage ${quoted(entry.old.name)} to ${quoted(entry.new.name)}`,
            };
          }
          return null;
        }
        default:
          return null;
      }
    case "task_warnings":
      if (entry.action !== "warning_overridden") return null;
      return {
        text: `assigned ${nameOf(context, meta.member_id)} despite ${WARNING_TEXT[String(meta.kind)] ?? "a warning"}`,
      };
    default:
      return null;
  }
}

/**
 * Who acted: "Ravi", or "Ravi for Asha" when a coordinator acted for a freelancer. Since Kickoff 4
 * decision 21 every viewer's directory holds whoever acted on a task they can see, so the name is
 * always there; "Someone" only covers a row the read raced.
 */
function actorOf(entry: TaskActivityEntry, context: TaskActivityContext): string {
  return pairName(context.names, entry.actorId, entry.onBehalfOfId);
}

/** The history line for one entry, or null when it only echoes another (or is a comment). */
export function describeTaskActivity(
  entry: TaskActivityEntry,
  context: TaskActivityContext,
): TaskHistoryLine | null {
  const line = describe(entry, context);
  if (!line) return null;
  return {
    id: entry.id,
    at: entry.at,
    actor: actorOf(entry, context),
    actorKey: `${entry.actorId ?? ""}|${entry.onBehalfOfId ?? ""}`,
    text: line.text,
    ...(line.note ? { note: line.note } : {}),
    ...(line.tick ? { tick: line.tick } : {}),
  };
}

/** How close consecutive ticks by the same person must be to share a line (decision 29). */
export const TICK_COLLAPSE_MS = 10 * 60_000;

/** "“Cut”", "“Cut” and “Grade”", "“Cut” and another stage", "3 stages". */
function stagesPhrase(stages: readonly (string | null)[]): string {
  const named = stages.filter((stage): stage is string => stage !== null);
  const parts = named.filter((stage, index) => named.indexOf(stage) === index).map(quoted);
  const unknown = stages.length - named.length;
  if (unknown > 0) {
    parts.push(
      parts.length > 0
        ? unknown === 1
          ? "another stage"
          : `${unknown} more stages`
        : unknown === 1
          ? "a stage"
          : `${unknown} stages`,
    );
  }
  return joinClauses(parts);
}

/** One line for a run of ticks: "ticked “Cut” and “Grade”, unticked a stage". */
function mergeTicks(run: readonly TaskHistoryLine[]): TaskHistoryLine {
  const newest = run[run.length - 1] as TaskHistoryLine;
  const ticked = run.flatMap((line) => (line.tick?.done ? [line.tick.stage] : []));
  const unticked = run.flatMap((line) => (line.tick && !line.tick.done ? [line.tick.stage] : []));
  const clauses = [
    ...(ticked.length > 0 ? [`ticked ${stagesPhrase(ticked)}`] : []),
    ...(unticked.length > 0 ? [`unticked ${stagesPhrase(unticked)}`] : []),
  ];
  return { ...newest, text: clauses.join(", "), count: run.length };
}

/**
 * The history with consecutive stage ticks and unticks by the same person (the same pair, for a
 * coordinator) collapsed into one line (Kickoff 4 decision 29): a run starts at a tick and takes
 * the ticks right after it by the same person within `TICK_COLLAPSE_MS` of its first, so an hour
 * of ticking never becomes one line. Anything else between two ticks ends the run. `lines` and
 * the result are newest first, as the history reads; a collapsed line carries its newest time.
 */
export function collapseTicks(
  lines: readonly TaskHistoryLine[],
  windowMs: number = TICK_COLLAPSE_MS,
): TaskHistoryLine[] {
  const out: TaskHistoryLine[] = [];
  let run: TaskHistoryLine[] = [];
  const flush = () => {
    const [only] = run;
    if (only) out.push(run.length === 1 ? only : mergeTicks(run));
    run = [];
  };
  for (const line of [...lines].reverse()) {
    const first = run[0];
    if (
      line.tick &&
      first &&
      first.actorKey === line.actorKey &&
      Date.parse(line.at) - Date.parse(first.at) <= windowMs
    ) {
      run.push(line);
      continue;
    }
    flush();
    if (line.tick) run = [line];
    else out.push(line);
  }
  flush();
  return out.reverse();
}
