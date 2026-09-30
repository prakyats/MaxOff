import { formatIST, toISTDate } from "@/core/time";

import { isFinal, isLocked, statusLine, type ActingFor, type TaskActions } from "./task";
import type { Task, TaskAssignee, TaskState } from "./types";

/**
 * The task page as the owner reworked it (Kickoff 4 decisions 26–32): the first glance (a line
 * with the state, priority and a relative deadline; what is needed from the viewer; the one next
 * step), the views below it (Work, Chat, Activity, Details) and the unread comments. Pure, so the
 * rules are unit-tested; the transition functions decide again on every tap.
 */

// The first glance (26) ---------------------------------------------------------------------------

/** The deadline in words, the viewer's distance to it, and whether it has passed (IST). */
export type RelativeDeadline = {
  /** "Due today 6:00 PM", "Due tomorrow 10:00 AM", "Due Thu 6:00 PM", "Due Thu 8 Oct, 6:00 PM". */
  label: string;
  /** "in 3 h", "in 25 min", "in 4 days", "overdue by 3 h"; null on a completed or cancelled task. */
  relative: string | null;
  overdue: boolean;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Whole IST calendar days from `from` to `to` (both ISO dates). */
function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/**
 * "25 min", "3 h", "4 days", rounded as people say them: minutes under an hour, hours under two
 * days, then days.
 */
function span(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(ms / HOUR);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(ms / DAY)} days`;
}

/**
 * The deadline as the first glance says it (decision 26: "Due today 6:00 PM · in 3 h", red when
 * overdue). The day is named relative to today in IST (today, tomorrow, yesterday, the weekday
 * within the week ahead), else the date, with the year when it is not this one. A completed or
 * cancelled task keeps the date and drops the distance.
 */
export function relativeDeadline(task: Pick<Task, "dueAt" | "state">, now: Date): RelativeDeadline {
  const today = toISTDate(now);
  const day = toISTDate(task.dueAt);
  const days = dayDistance(today, day);
  const time = formatIST(task.dueAt, "h:mm a");
  const when =
    days === 0
      ? `today ${time}`
      : days === 1
        ? `tomorrow ${time}`
        : days === -1
          ? `yesterday ${time}`
          : days > 1 && days < 7
            ? `${formatIST(task.dueAt, "EEE")} ${time}`
            : day.slice(0, 4) === today.slice(0, 4)
              ? `${formatIST(task.dueAt, "EEE d MMM")}, ${time}`
              : `${formatIST(task.dueAt, "EEE d MMM yyyy")}, ${time}`;
  const label = `Due ${when}`;
  if (isFinal(task.state)) return { label, relative: null, overdue: false };
  const left = Date.parse(task.dueAt) - now.getTime();
  if (left >= 0)
    return { label, relative: left < MINUTE ? "now" : `in ${span(left)}`, overdue: false };
  return { label, relative: `overdue by ${span(-left)}`, overdue: true };
}

/**
 * The viewer's next step: the one primary action (decision 26), in the order the work goes: Task
 * Noted (their own first, then each freelancer's they coordinate, one at a time), Start work, Mark
 * done, then the review step's decision. Null when nothing waits for the viewer.
 */
export type NextStep =
  | { kind: "note"; acting: ActingFor }
  | { kind: "start"; acting: ActingFor }
  | { kind: "done"; acting: ActingFor; again: boolean }
  | { kind: "review"; step: "admin" | "owner" };

export function nextStep(
  actions: Pick<TaskActions, "note" | "start" | "done" | "review">,
): NextStep | null {
  const [note] = actions.note;
  if (note) return { kind: "note", acting: note };
  if (actions.start) return { kind: "start", acting: actions.start };
  if (actions.done) {
    return {
      kind: "done",
      acting: { onBehalfOf: actions.done.onBehalfOf },
      again: actions.done.again,
    };
  }
  if (actions.review) return { kind: "review", step: actions.review };
  return null;
}

/**
 * What the ⋯ adds to the viewer's work beside the next step (decision 26: "everything else under
 * ⋯"): Mark done while Start work is the next step (Done may come straight from To do, WORKFLOWS
 * §3.1), and the Owner's "Decide it yourself" at a waiting Admin step.
 */
export type MoreStep = "done" | "takeOver";

export function moreSteps(
  actions: Pick<TaskActions, "done" | "takeOver">,
  next: NextStep | null,
): MoreStep[] {
  const more: MoreStep[] = [];
  if (actions.done && next?.kind !== "done") more.push("done");
  if (actions.takeOver) more.push("takeOver");
  return more;
}

/**
 * "What's needed from you" (decision 26): the next step in a sentence, or, when nothing waits for
 * the viewer, where the task stands. `nameOf` answers "you" for the viewer; `forName` names the
 * freelancer a coordinator acts for.
 */
export function neededLine(input: {
  task: Pick<Task, "state" | "adminStep" | "approvingAdminId" | "primaryOwnerId" | "completedAt">;
  assignees: readonly TaskAssignee[];
  next: NextStep | null;
  nameOf: (memberId: string) => string;
}): string {
  const { task, next, nameOf } = input;
  const forName = (acting: ActingFor) => (acting.onBehalfOf ? nameOf(acting.onBehalfOf) : null);
  if (next) {
    switch (next.kind) {
      case "note": {
        const who = forName(next.acting);
        return who
          ? `Note it for ${who} when ${who} has seen it.`
          : "Tap Task Noted to say you've seen it.";
      }
      case "start": {
        const who = forName(next.acting);
        return who ? `Start work for ${who} when ${who} begins.` : "Start work when you begin.";
      }
      case "done": {
        const who = forName(next.acting);
        if (next.again) {
          return who
            ? `Changes were asked for. Mark it done again for ${who} once they're fixed.`
            : "Changes were asked for. Fix them, then mark it done again.";
        }
        return who
          ? `Mark it done for ${who} when the work is finished.`
          : "Mark it done when the work is finished.";
      }
      case "review":
        return next.step === "admin"
          ? "Check the hand-in, then approve it or ask for changes."
          : "Approve it to complete the task, or ask for changes.";
    }
  }
  const status = statusLine(task, input.assignees, nameOf);
  return isFinal(task.state) ? status : `Nothing needed from you now. ${status}`;
}

// The views (27, 32) ------------------------------------------------------------------------------

export type TaskView = "work" | "chat" | "activity" | "details";

export const TASK_VIEWS: readonly TaskView[] = ["work", "chat", "activity", "details"];

/** The view a `?tab=` value asks for; anything else is Work, where a task lands (decision 32). */
export function parseTaskView(value: string | null | undefined): TaskView {
  return TASK_VIEWS.find((view) => view === value) ?? "work";
}

/**
 * What a screen shows for the view chosen (decision 32): a phone has no Chat view (Chat is a
 * full-height sheet over the page) and a desktop no Details view (Details is the right panel), so
 * either falls back to Work there.
 */
export function shownView(view: TaskView, desktop: boolean): TaskView {
  if (view === "chat" && !desktop) return "work";
  if (view === "details" && desktop) return "work";
  return view;
}

/**
 * The page's query with the view in it (a view control's URL, replaced, never pushed; §14.2 d):
 * Work, the landing view, is left out, and every other parameter is kept.
 */
export function viewQuery(search: string, view: TaskView): string {
  const params = new URLSearchParams(search);
  if (view === "work") params.delete("tab");
  else params.set("tab", view);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The hand-in leads the Work view once the task is handed in and locked (submitted, waiting for
 * the Owner, completed), so a reviewer lands on it (decision 32); while the task is with its
 * people (and after a cancel) the stages lead and the earlier hand-in follows them.
 */
export function handInFirst(state: TaskState): boolean {
  return isLocked(state) && state !== "cancelled";
}

// Chat (28) ---------------------------------------------------------------------------------------

/**
 * Comments the viewer has not read: written by someone else (never their own, one they wrote for
 * a freelancer included) after their last read (every one when they have none). The same rule as
 * `task_unread_counts()`, which the lists read.
 */
export function unreadCount(
  comments: readonly { authorId: string; createdAt: string }[],
  lastReadAt: string | null,
  viewerId: string,
): number {
  const after = lastReadAt === null ? Number.NEGATIVE_INFINITY : Date.parse(lastReadAt);
  return comments.filter(
    (comment) => comment.authorId !== viewerId && Date.parse(comment.createdAt) > after,
  ).length;
}

/** The newest comment's time: what opening Chat marks as read. Null when there is none. */
export function newestCommentAt(comments: readonly { createdAt: string }[]): string | null {
  let newest: string | null = null;
  for (const comment of comments) {
    if (newest === null || Date.parse(comment.createdAt) > Date.parse(newest)) {
      newest = comment.createdAt;
    }
  }
  return newest;
}

/** The composer's "Writing as" choice for the viewer themselves (a freelancer's id otherwise). */
export const WRITING_AS_SELF = "__self__";

/** The Chat tab's label (decision 28): "Chat", or "Chat · 2 new". */
export function chatLabel(unread: number): string {
  return unread > 0 ? `Chat · ${unread} new` : "Chat";
}

/** A list row's unread marker, spoken: "1 new comment", "3 new comments". */
export function unreadLabel(unread: number): string {
  return unread === 1 ? "1 new comment" : `${unread} new comments`;
}
