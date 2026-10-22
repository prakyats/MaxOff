import { describe, expect, it } from "vitest";

import { istInstant } from "@/core/time";

import type { TaskActivityEntry } from "../domain/activity";
import {
  type ChatEvent,
  type ChatGroup,
  type ChatMessage,
  chatRows,
  firstUnreadId,
  GROUP_GAP_MS,
  mergeMessages,
} from "../domain/chat";
import { chatDayLabel, chatEvents, chatMessages, initialsOf } from "../domain/chat-feed";

const TODAY = "2026-10-22";
const ME = "00000000-0000-4000-8000-000000000001";
const ASHA = "00000000-0000-4000-8000-000000000002";
const RAVI = "00000000-0000-4000-8000-000000000003";
const NAMES = { [ME]: "Prishit Shah", [ASHA]: "Asha Rao", [RAVI]: "Ravi" };

let next = 0;
function comment(authorId: string, at: string, body = "hi", onBehalfOf: string | null = null) {
  next += 1;
  return { id: `c${String(next).padStart(3, "0")}`, authorId, onBehalfOf, body, createdAt: at };
}

function messages(...rows: ReturnType<typeof comment>[]): ChatMessage[] {
  return chatMessages(rows, {
    viewerId: ME,
    names: NAMES,
    photos: { [ASHA]: "file-1" },
    today: TODAY,
  });
}

const at = (day: string, time: string) => istInstant(day, time);
const groups = (rows: ReturnType<typeof chatRows>) =>
  rows.filter((row): row is ChatGroup => row.kind === "group");

describe("chat day dividers", () => {
  it("say Today, Yesterday, then the weekday and date (the year only when it differs)", () => {
    expect(chatDayLabel("2026-10-22", TODAY)).toBe("Today");
    expect(chatDayLabel("2026-10-21", TODAY)).toBe("Yesterday");
    expect(chatDayLabel("2026-10-20", TODAY)).toBe("Tue 20 Oct");
    expect(chatDayLabel("2025-12-29", TODAY)).toBe("Mon 29 Dec 2025");
  });

  it("split the feed by IST day: 11:50 pm and 12:10 am are two days", () => {
    const rows = chatRows(
      messages(comment(ASHA, at("2026-10-21", "23:50")), comment(ASHA, at("2026-10-22", "00:10"))),
      [],
      { newFrom: null, complete: true },
    );
    expect(rows.map((row) => (row.kind === "day" ? row.label : row.kind))).toEqual([
      "Yesterday",
      "group",
      "Today",
      "group",
    ]);
  });

  it("come once a day, however many groups that day holds", () => {
    const rows = chatRows(
      messages(
        comment(ASHA, at(TODAY, "09:00")),
        comment(ME, at(TODAY, "09:01")),
        comment(ASHA, at(TODAY, "09:02")),
      ),
      [],
      { newFrom: null, complete: true },
    );
    expect(rows.filter((row) => row.kind === "day")).toHaveLength(1);
    expect(groups(rows)).toHaveLength(3);
  });
});

describe("chat grouping", () => {
  it("groups one person's consecutive messages within five minutes, the time once at the end", () => {
    const rows = chatRows(
      messages(
        comment(ASHA, at(TODAY, "19:58"), "True"),
        comment(ASHA, at(TODAY, "19:59"), "Yes yes"),
        comment(ASHA, at(TODAY, "20:03"), "Will do"),
      ),
      [],
      { newFrom: null, complete: true },
    );
    const [group] = groups(rows);
    expect(groups(rows)).toHaveLength(1);
    expect(group?.messages.map((message) => message.body)).toEqual(["True", "Yes yes", "Will do"]);
    expect(group?.time).toBe("8:03 pm");
    expect(group?.author).toBe("Asha Rao");
    expect(group?.photo).toBe("file-1");
    expect(group?.initials).toBe("AR");
  });

  it("starts a new group after more than five minutes, or when someone else writes", () => {
    const rows = chatRows(
      messages(
        comment(ASHA, at(TODAY, "10:00")),
        comment(ASHA, at(TODAY, "10:05")),
        comment(ASHA, at(TODAY, "10:11")),
        comment(ME, at(TODAY, "10:12")),
        comment(ASHA, at(TODAY, "10:13")),
      ),
      [],
      { newFrom: null, complete: true },
    );
    expect(GROUP_GAP_MS).toBe(5 * 60_000);
    expect(groups(rows).map((group) => [group.own, group.messages.length])).toEqual([
      [false, 2],
      [false, 1],
      [true, 1],
      [false, 1],
    ]);
  });

  it("keeps a coordinator's own and their messages for a freelancer apart (the pair is the writer)", () => {
    const rows = chatRows(
      messages(
        comment(ME, at(TODAY, "10:00"), "mine"),
        comment(ME, at(TODAY, "10:01"), "for Asha", ASHA),
      ),
      [],
      { newFrom: null, complete: true },
    );
    expect(groups(rows).map((group) => group.author)).toEqual(["You", "You for Asha Rao"]);
  });

  it("breaks a group at the red New line and at a task event", () => {
    const list = messages(
      comment(ASHA, at(TODAY, "10:00")),
      comment(ASHA, at(TODAY, "10:01")),
      comment(ASHA, at(TODAY, "10:02")),
      comment(ASHA, at(TODAY, "10:04")),
    );
    const event: ChatEvent = {
      id: "9",
      text: "Asha Rao noted the task · 10:03 am",
      at: at(TODAY, "10:03"),
      atMs: Date.parse(at(TODAY, "10:03")),
      day: TODAY,
      dayLabel: "Today",
      time: "10:03 am",
    };
    const rows = chatRows(list, [event], { newFrom: list[1]?.id ?? null, complete: true });
    expect(rows.map((row) => row.kind)).toEqual(["day", "group", "new", "group", "event", "group"]);
  });
});

describe("chat events and earlier pages", () => {
  it("leaves out events older than the oldest message held while earlier messages remain", () => {
    const list = messages(comment(ASHA, at(TODAY, "12:00")));
    const event = (time: string): ChatEvent => ({
      id: time,
      text: time,
      at: at(TODAY, time),
      atMs: Date.parse(at(TODAY, time)),
      day: TODAY,
      dayLabel: "Today",
      time,
    });
    const events = [event("11:00"), event("13:00")];
    const partial = chatRows(list, events, { newFrom: null, complete: false });
    expect(partial.filter((row) => row.kind === "event")).toHaveLength(1);
    const whole = chatRows(list, events, { newFrom: null, complete: true });
    expect(whole.filter((row) => row.kind === "event")).toHaveLength(2);
  });

  it("merges an earlier page with the latest once each, oldest first", () => {
    const a = messages(comment(ASHA, at(TODAY, "09:00")), comment(ASHA, at(TODAY, "09:10")));
    const b = messages(comment(ME, at(TODAY, "10:00")));
    const merged = mergeMessages(a, [...b, a[1] as ChatMessage]);
    expect(merged.map((message) => message.atMs)).toEqual(
      [...a, ...b].map((message) => message.atMs),
    );
  });

  it("finds the first unread: someone else's, after the reader's last read", () => {
    const list = [
      comment(ASHA, at(TODAY, "09:00")),
      comment(ME, at(TODAY, "09:05")),
      comment(ASHA, at(TODAY, "09:10")),
    ];
    expect(firstUnreadId(list, null, ME)).toBe(list[0]?.id);
    expect(firstUnreadId(list, at(TODAY, "09:00"), ME)).toBe(list[2]?.id);
    expect(firstUnreadId(list, at(TODAY, "09:10"), ME)).toBeNull();
  });
});

describe("chat's quiet event lines", () => {
  const entry = (overrides: Partial<TaskActivityEntry>): TaskActivityEntry => ({
    id: 1,
    actorId: ASHA,
    onBehalfOfId: null,
    entity: "tasks",
    action: "updated",
    old: {},
    new: {},
    meta: {},
    at: at(TODAY, "15:11"),
    ...overrides,
  });
  const people = { viewerId: ME, names: NAMES, today: TODAY };

  it("say who noted the task, a moved deadline and a reminder sent; nothing else", () => {
    const events = chatEvents(
      [
        entry({ id: 1, entity: "task_assignees", action: "acknowledged" }),
        entry({
          id: 2,
          actorId: ME,
          meta: { fields: ["due_at"] },
          new: { due_at: at("2026-10-23", "18:00") },
          at: at(TODAY, "16:00"),
        }),
        entry({
          id: 3,
          action: "reminder_sent",
          meta: { recipients: [RAVI] },
          at: at(TODAY, "17:00"),
        }),
        entry({ id: 4, meta: { fields: ["title"] }, new: { title: "New name" } }),
        entry({ id: 5, action: "created" }),
      ],
      people,
    );
    expect(events.map((event) => event.text)).toEqual([
      "Asha Rao noted the task · 3:11 pm",
      "Deadline moved to Fri 23 Oct, 6:00 pm by you",
      "Asha Rao sent Ravi a reminder · 5:00 pm",
    ]);
  });

  it("names the pair when a coordinator noted for a freelancer", () => {
    const [event] = chatEvents(
      [
        entry({
          entity: "task_assignees",
          action: "acknowledged",
          actorId: RAVI,
          onBehalfOfId: ASHA,
        }),
      ],
      people,
    );
    expect(event?.text).toBe("Ravi for Asha Rao noted the task · 3:11 pm");
  });

  it("words initials from a full name", () => {
    expect(initialsOf("Asha Rao")).toBe("AR");
    expect(initialsOf("Ravi")).toBe("R");
    expect(initialsOf(" ")).toBe("?");
  });
});
