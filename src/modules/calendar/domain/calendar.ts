import {
  addISTDays,
  formatIST,
  isISODate,
  istDayStart,
  istWeekday,
  toISTDate,
  type ISODate,
} from "@/core/time";

/**
 * The calendar's rules (6.4; Kickoff 6 decisions 13–15, 22; PRODUCT §4.8, PERMISSIONS §2
 * "Calendar"): the views and their ranges, the address (view, day and filters are view state,
 * ARCHITECTURE §14.2 d), and what each role's day holds: event tasks at their date and time,
 * ordinary deadlines as a "Due" list, leave, holidays and weekly offs, and for an Admin other
 * people's events as "Busy" blocks. Pure (ADR-0011): the page reads, this decides; unit-tested.
 */

export const CALENDAR_VIEWS = ["day", "week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** `all`: open and completed events; `open`: not completed; `done`: completed only. */
export const STATUS_FILTERS = ["all", "open", "done"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "Open and completed",
  open: "Open",
  done: "Completed",
};

/**
 * What the address says. `view` is the laptop's (Day, Week or Month; null = Month, decision 25);
 * a phone has one calendar whatever the view, and `date` is its selected day (an email's
 * `?view=day&date=…` opens with that day selected). Never decided by sniffing the device.
 */
export type CalendarQuery = {
  view: CalendarView | null;
  date: ISODate;
  client: string | null;
  person: string | null;
  type: string | null;
  status: StatusFilter;
};

const ID = /^[0-9a-f-]{36}$/i;

function one(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first ? first : null;
}

function id(value: string | string[] | undefined): string | null {
  const text = one(value);
  return text && ID.test(text) ? text : null;
}

/** The address, read: an unknown view, a malformed date or an odd filter falls back quietly. */
export function parseCalendarQuery(
  params: Record<string, string | string[] | undefined>,
  today: ISODate,
): CalendarQuery {
  const view = one(params.view);
  const date = one(params.date);
  const status = one(params.status);
  return {
    view: (CALENDAR_VIEWS as readonly string[]).includes(view ?? "")
      ? (view as CalendarView)
      : null,
    date: date && isISODate(date) ? date : today,
    client: id(params.client),
    person: id(params.person),
    type: id(params.type),
    status: (STATUS_FILTERS as readonly string[]).includes(status ?? "")
      ? (status as StatusFilter)
      : "all",
  };
}

/** The address for a query: `/calendar` alone when everything is the default. */
export function calendarHref(query: CalendarQuery, today: ISODate): string {
  const parts: string[] = [];
  if (query.view) parts.push(`view=${query.view}`);
  if (query.date !== today) parts.push(`date=${query.date}`);
  if (query.client) parts.push(`client=${query.client}`);
  if (query.person) parts.push(`person=${query.person}`);
  if (query.type) parts.push(`type=${query.type}`);
  if (query.status !== "all") parts.push(`status=${query.status}`);
  return parts.length === 0 ? "/calendar" : `/calendar?${parts.join("&")}`;
}

/** Whether any filter narrows the calendar. */
export function hasFilters(query: CalendarQuery): boolean {
  return (
    query.client !== null || query.person !== null || query.type !== null || query.status !== "all"
  );
}

export type DateRange = { from: ISODate; to: ISODate };

/** The Monday-to-Sunday IST week holding `date`. */
export function weekOf(date: ISODate): DateRange {
  const from = addISTDays(date, -((istWeekday(date) + 6) % 7));
  return { from, to: addISTDays(from, 6) };
}

/** The first day of `date`'s month. */
export function monthOf(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

/** The first day of the month `months` away. */
export function addMonths(month: ISODate, months: number): ISODate {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(index / 12);
  const m = ((index % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** The last day of `month`. */
export function monthEnd(month: ISODate): ISODate {
  return addISTDays(addMonths(month, 1), -1);
}

export type MonthGrid = { month: ISODate; from: ISODate; to: ISODate; weeks: ISODate[][] };

/** The month view's grid: whole Monday-to-Sunday weeks from the 1st to the last day (4 to 6). */
export function monthGrid(date: ISODate): MonthGrid {
  const month = monthOf(date);
  const { from } = weekOf(month);
  const { to } = weekOf(monthEnd(month));
  const weeks: ISODate[][] = [];
  for (let day = from; day <= to; day = addISTDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, offset) => addISTDays(day, offset)));
  }
  return { month, from, to, weeks };
}

/**
 * The days a query reads: the month grid of its date (decision 25), which holds the phone's month
 * and its week strip and the laptop's Day, Week and Month alike (a week is always inside its
 * month's grid), so changing the view or the selected day in that month reads nothing new.
 */
export function rangeFor(query: CalendarQuery): DateRange {
  const grid = monthGrid(query.date);
  return { from: grid.from, to: grid.to };
}

/** The query one step before or after: a day, a week or a month, by the view. */
export function shifted(query: CalendarQuery, direction: -1 | 1): CalendarQuery {
  if (query.view === "month") return { ...query, date: addMonths(monthOf(query.date), direction) };
  if (query.view === "day") return { ...query, date: addISTDays(query.date, direction) };
  return { ...query, date: addISTDays(query.date, 7 * direction) };
}

// What a day holds ------------------------------------------------------------------------------------

/** An event task as the reads hand it over (the tasks module's `EventTask`, structurally). */
export type EventSource = {
  id: string;
  title: string;
  state: string;
  eventDate: ISODate;
  eventStartAt: string | null;
  eventEndAt: string | null;
  location: string | null;
  clientId: string | null;
  taskTypeId: string;
  primaryOwnerId: string;
  assigneeIds: readonly string[];
};

/** An open task as the lists hand it over (the "Due" list). */
export type DueSource = {
  id: string;
  title: string;
  dueAt: string;
  clientId: string | null;
  taskTypeId: string;
  primaryOwnerId: string;
  /** The active assignees. */
  assigneeIds: readonly string[];
};

/**
 * A client item with a planned date (kickoff 7 decision 21, refreshed under decision 25): the
 * Owner's and the client's Admin's only, never Crew (the page reads none for them).
 */
export type ClientItemSource = {
  id: string;
  title: string;
  state: "open" | "done";
  plannedDate: ISODate;
  projectName: string;
  clientId: string;
  clientName: string;
  /** The project on the item's cycle, with the item's sheet open. */
  href: string;
};

export type LeaveSource = {
  memberId: string;
  type: "leave" | "half_day" | "comp_leave";
  startDate: ISODate;
  endDate: ISODate;
  /** A request still waiting for the Owner: marked as requested (decision 13). */
  pending: boolean;
};

/** One `member_availability()` row (an Admin's view of others): their leave and busy blocks. */
export type AvailabilitySource = {
  memberId: string;
  day: ISODate;
  leave: string | null;
  blocks: readonly { startAt: string | null; endAt: string | null }[];
};

export type PersonSource = { id: string; name: string; engagement: "permanent" | "freelance" };

/** Who the viewer is to the calendar (PERMISSIONS §2 "Calendar"). */
export type CalendarScope = "owner" | "admin" | "staff";

export type CalendarInput = {
  range: DateRange;
  scope: CalendarScope;
  viewerId: string;
  query: CalendarQuery;
  events: readonly EventSource[];
  openTasks: readonly DueSource[];
  /**
   * The task types in the Owner's order, each with its calendar colour already resolved to the
   * palette (decision 25): an event's strip and block take it, and the order ranks the strips.
   */
  types: readonly { id: string; name: string; showsOnCalendar: boolean; color: string }[];
  clients: readonly { id: string; name: string }[];
  people: readonly PersonSource[];
  holidays: readonly { date: ISODate; name: string }[];
  weeklyOffDays: readonly number[];
  /** Leave the viewer reads in full: their own, or everyone's for the Owner. */
  leave: readonly LeaveSource[];
  /** An Admin's `member_availability()` rows; null for the Owner and Crew. */
  availability: readonly AvailabilitySource[] | null;
  /** Client items planned in the range (7.3): the Owner's and the client's Admin's; [] for Crew. */
  clientItems?: readonly ClientItemSource[];
};

export type EventItem = {
  kind: "event";
  id: string;
  title: string;
  date: ISODate;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  clientName: string | null;
  typeName: string | null;
  /** The type's colour (decision 25), for its strip and its block. */
  color: string;
  /** The type's place in the Owner's order: shoots and site visits before meetings (decision 25). */
  rank: number;
  /** Owner-approved: shown muted (decision 14). */
  completed: boolean;
  /** The people on it, by name (a freelancer "(freelancer)"). */
  people: string[];
};

export type BusyItem = {
  kind: "busy";
  memberId: string;
  name: string;
  date: ISODate;
  startAt: string;
  endAt: string;
};

export type LeaveItem = {
  kind: "leave";
  memberId: string;
  name: string;
  date: ISODate;
  /** "Leave", "Half day", "Comp leave" in full detail; "On leave" / "Half day" for an Admin's others. */
  label: string;
  /** A half day: "½" on its strip (decision 25). */
  half: boolean;
  pending: boolean;
  own: boolean;
};

export type DueItem = { kind: "due"; id: string; title: string; dueAt: string; owner: string };

/** A client item on its planned day: "Client items · N" (7.3); done ones are muted. */
export type ClientItemEntry = {
  kind: "item";
  id: string;
  title: string;
  project: string;
  client: string;
  href: string;
  done: boolean;
};

export type CalendarDay = {
  date: ISODate;
  holiday: string | null;
  weeklyOff: boolean;
  leave: LeaveItem[];
  events: EventItem[];
  busy: BusyItem[];
  due: DueItem[];
  items: ClientItemEntry[];
};

const LEAVE_LABELS: Record<LeaveSource["type"], string> = {
  leave: "Leave",
  half_day: "Half day",
  comp_leave: "Comp leave",
};

/** What an Admin sees of another person's leave: the fact, never the type or a request. */
function othersLeaveLabel(value: string | null): string | null {
  if (value === "leave" || value === "comp_leave") return "On leave";
  if (value === "half_day") return "Half day";
  return null;
}

const HOUR_MS = 60 * 60 * 1000;

/** An event whose type is unknown to the viewer is drawn in the palette's default (blue). */
export const DEFAULT_EVENT_COLOR = "#2563eb";

/** A block's end: the event's, else an hour after its start (as `member_availability()` does). */
function blockEnd(startAt: string, endAt: string | null): string {
  return endAt ?? new Date(new Date(startAt).getTime() + HOUR_MS).toISOString();
}

function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

function byStart<T extends { startAt: string | null; title?: string; name?: string }>(
  a: T,
  b: T,
): number {
  if (a.startAt === null || b.startAt === null) {
    if (a.startAt === b.startAt)
      return (a.title ?? a.name ?? "").localeCompare(b.title ?? b.name ?? "");
    return a.startAt === null ? -1 : 1;
  }
  const delta = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  return delta !== 0 ? delta : (a.title ?? a.name ?? "").localeCompare(b.title ?? b.name ?? "");
}

/**
 * The days of the range, each with what the viewer may see on it, filtered. Events are the tasks
 * whose type shows on the calendar, at their event date (cancelled ones never arrive; completed
 * ones are flagged to be muted). The "Due" list is every other open task due that day. Leave is
 * expanded from its span; an Admin's others come from availability as "On leave" / "Half day",
 * their timed events as "Busy" blocks (a block matching a task the Admin sees is dropped, so an
 * event is never shown twice).
 */
export function buildCalendar(input: CalendarInput): CalendarDay[] {
  const { query, range } = input;
  const typeOf = new Map(input.types.map((type) => [type.id, type]));
  const rankOf = new Map(input.types.map((type, index) => [type.id, index]));
  const clientOf = new Map(input.clients.map((client) => [client.id, client.name]));
  const personOf = new Map(input.people.map((person) => [person.id, person]));
  const nameOf = (memberId: string) => {
    const person = personOf.get(memberId);
    if (!person) return "Someone";
    return person.engagement === "freelance" ? `${person.name} (freelancer)` : person.name;
  };
  const inRange = (date: ISODate) => date >= range.from && date <= range.to;
  const passes = (task: {
    clientId: string | null;
    taskTypeId: string;
    assigneeIds: readonly string[];
  }) =>
    (query.client === null || task.clientId === query.client) &&
    (query.type === null || task.taskTypeId === query.type) &&
    (query.person === null || task.assigneeIds.includes(query.person));
  const personPasses = (memberId: string) => query.person === null || memberId === query.person;

  const days = new Map<ISODate, CalendarDay>();
  for (let date = range.from; date <= range.to; date = addISTDays(date, 1)) {
    days.set(date, {
      date,
      holiday: input.holidays.find((holiday) => holiday.date === date)?.name ?? null,
      weeklyOff: input.weeklyOffDays.includes(istWeekday(date)),
      leave: [],
      events: [],
      busy: [],
      due: [],
      items: [],
    });
  }
  const dayOf = (date: ISODate) => days.get(date);

  // Events: the tasks whose type shows on the calendar (an unknown type shows).
  const shown = new Set<string>();
  for (const event of input.events) {
    const day = dayOf(event.eventDate);
    if (!day) continue;
    const type = typeOf.get(event.taskTypeId);
    if (type && !type.showsOnCalendar) continue;
    shown.add(event.id);
    const completed = event.state === "completed";
    if (query.status === "open" && completed) continue;
    if (query.status === "done" && !completed) continue;
    if (!passes(event)) continue;
    day.events.push({
      kind: "event",
      id: event.id,
      title: event.title,
      date: event.eventDate,
      startAt: event.eventStartAt,
      endAt: event.eventStartAt ? blockEnd(event.eventStartAt, event.eventEndAt) : null,
      location: event.location,
      clientName: event.clientId ? (clientOf.get(event.clientId) ?? null) : null,
      typeName: type?.name ?? null,
      color: type?.color ?? DEFAULT_EVENT_COLOR,
      rank: rankOf.get(event.taskTypeId) ?? input.types.length,
      completed,
      people: event.assigneeIds.map(nameOf),
    });
  }

  // Due: every other open task, at its deadline's IST day (never when only completed is asked).
  if (query.status !== "done") {
    for (const task of input.openTasks) {
      if (shown.has(task.id)) continue;
      const day = dayOf(toISTDate(task.dueAt));
      if (!day || !passes(task)) continue;
      day.due.push({
        kind: "due",
        id: task.id,
        title: task.title,
        dueAt: task.dueAt,
        owner: nameOf(task.primaryOwnerId),
      });
    }
  }

  // Client items (kickoff 7 decision 21 in decision 25's priority): never Crew's; the client
  // filter applies, a type or person filter hides them (an item has neither); approved, closed
  // and carried ones are not read at all. **Q15 (advisor 2026-10-08, owner to confirm):**
  // "Completed" shows no client items (an approved one is hidden by decision 21, and a done one
  // waiting for approval is not completed); "Open" keeps the open ones and the done ones, muted,
  // exactly as with no filter.
  if (
    input.scope !== "staff" &&
    query.type === null &&
    query.person === null &&
    query.status !== "done"
  ) {
    for (const item of input.clientItems ?? []) {
      const day = dayOf(item.plannedDate);
      if (!day) continue;
      if (query.client !== null && item.clientId !== query.client) continue;
      day.items.push({
        kind: "item",
        id: item.id,
        title: item.title,
        project: item.projectName,
        client: item.clientName,
        href: item.href,
        done: item.state === "done",
      });
    }
  }

  // Leave the viewer reads in full (own, or everyone's for the Owner).
  for (const span of input.leave) {
    if (!personPasses(span.memberId)) continue;
    const first = span.startDate > range.from ? span.startDate : range.from;
    const last = span.endDate < range.to ? span.endDate : range.to;
    for (let date = first; date <= last; date = addISTDays(date, 1)) {
      dayOf(date)?.leave.push({
        kind: "leave",
        memberId: span.memberId,
        name: nameOf(span.memberId),
        date,
        label: LEAVE_LABELS[span.type],
        half: span.type === "half_day",
        pending: span.pending,
        own: span.memberId === input.viewerId,
      });
    }
  }

  // An Admin's others: approved leave as a fact, timed events as Busy blocks.
  if (input.scope === "admin" && input.availability) {
    for (const row of input.availability) {
      if (row.memberId === input.viewerId || !personPasses(row.memberId)) continue;
      const day = dayOf(row.day);
      if (!day || !inRange(row.day)) continue;
      const label = othersLeaveLabel(row.leave);
      if (label) {
        day.leave.push({
          kind: "leave",
          memberId: row.memberId,
          name: nameOf(row.memberId),
          date: row.day,
          label,
          half: row.leave === "half_day",
          pending: false,
          own: false,
        });
      }
      for (const block of row.blocks) {
        if (!block.startAt) continue;
        const startAt = block.startAt;
        const endAt = blockEnd(startAt, block.endAt);
        const seen = input.events.some(
          (event) =>
            event.eventDate === row.day &&
            event.assigneeIds.includes(row.memberId) &&
            event.eventStartAt !== null &&
            sameInstant(event.eventStartAt, startAt) &&
            sameInstant(blockEnd(event.eventStartAt, event.eventEndAt), endAt),
        );
        if (seen) continue;
        day.busy.push({
          kind: "busy",
          memberId: row.memberId,
          name: nameOf(row.memberId),
          date: row.day,
          startAt,
          endAt,
        });
      }
    }
  }

  for (const day of days.values()) {
    day.events.sort(byStart);
    day.busy.sort(byStart);
    day.leave.sort((a, b) => a.name.localeCompare(b.name) || a.label.localeCompare(b.label));
    day.due.sort(
      (a, b) =>
        new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime() || a.title.localeCompare(b.title),
    );
  }
  return [...days.values()];
}

// Words --------------------------------------------------------------------------------------------

export const EMPTY_DAY = "Nothing on this day.";

/** "Today", "Tomorrow", "Yesterday" or "Tue 7 Oct". */
export function dayWord(date: ISODate, today: ISODate): string {
  if (date === today) return "Today";
  if (date === addISTDays(today, 1)) return "Tomorrow";
  if (date === addISTDays(today, -1)) return "Yesterday";
  return formatIST(istDayStart(date), "EEE d MMM");
}

/** The day view's heading: "Today · Tue 7 Oct 2026" or "Tue 7 Oct 2026". */
export function dayHeading(date: ISODate, today: ISODate): string {
  const full = formatIST(istDayStart(date), "EEE d MMM yyyy");
  const word = dayWord(date, today);
  return word === "Today" || word === "Tomorrow" || word === "Yesterday"
    ? `${word} · ${full}`
    : full;
}

/** "10:00 am – 11:30 am", "10:00 am" for an hour, or "All day". */
export function timeWords(startAt: string | null, endAt: string | null): string {
  if (!startAt) return "All day";
  const start = formatIST(startAt, "h:mm aaa");
  if (!endAt) return start;
  return `${start} – ${formatIST(endAt, "h:mm aaa")}`;
}

/** "6 – 12 Oct 2026", or "28 Sep – 4 Oct 2026" across a month end. */
export function weekLabel(range: DateRange): string {
  const from = istDayStart(range.from);
  const to = istDayStart(range.to);
  const sameMonth = range.from.slice(0, 7) === range.to.slice(0, 7);
  return sameMonth
    ? `${formatIST(from, "d")} – ${formatIST(to, "d MMM yyyy")}`
    : `${formatIST(from, "d MMM")} – ${formatIST(to, "d MMM yyyy")}`;
}

/** "October 2026". */
export function monthLabel(month: ISODate): string {
  return formatIST(istDayStart(month), "MMMM yyyy");
}

/** "1 due" / "3 due". */
export function dueWords(count: number): string {
  return `${count} due`;
}

/** "1 event" / "3 events". */
export function eventWords(count: number): string {
  return count === 1 ? "1 event" : `${count} events`;
}

/** "1 on leave" / "2 on leave". */
export function leaveWords(count: number): string {
  return `${count} on leave`;
}

/** A day with nothing on it (the page's fallback for a day outside what it read). */
export function emptyDay(date: ISODate): CalendarDay {
  return {
    date,
    holiday: null,
    weeklyOff: false,
    leave: [],
    events: [],
    busy: [],
    due: [],
    items: [],
  };
}

/**
 * The day's "due" count (decision 25 priority 2, with kickoff 7 decision 21): the open tasks due
 * that day and the open client items planned for it, together; a done item is listed, muted, but
 * not counted.
 */
export function dueCount(day: Pick<CalendarDay, "due" | "items">): number {
  return day.due.length + day.items.filter((item) => !item.done).length;
}

/** Whether a day has nothing to show at all (holiday and weekly off count as something). */
export function isEmptyDay(day: CalendarDay): boolean {
  return (
    day.holiday === null &&
    !day.weeklyOff &&
    day.leave.length === 0 &&
    day.events.length === 0 &&
    day.busy.length === 0 &&
    day.due.length === 0 &&
    day.items.length === 0
  );
}

/** How many filters narrow the calendar: "Filters · N" (decision 25 F). */
export function filterCount(query: CalendarQuery): number {
  return (
    (query.client ? 1 : 0) +
    (query.person ? 1 : 0) +
    (query.type ? 1 : 0) +
    (query.status !== "all" ? 1 : 0)
  );
}

/** The filters a role may use (decision 15): type only for Crew. */
export function filterKinds(scope: CalendarScope): ("client" | "person" | "type" | "status")[] {
  return scope === "staff" ? ["type"] : ["client", "person", "type", "status"];
}

/** The scope a role gives the calendar: the Owner everything, an Admin counts and blocks, Crew own. */
export function scopeFor(flags: { viewAll: boolean; availability: boolean }): CalendarScope {
  if (flags.viewAll) return "owner";
  if (flags.availability) return "admin";
  return "staff";
}
