import { addISTDays, formatIST, formatTime, toISTDate, type ISODate } from "@/core/time";

import type { TaskActivityEntry } from "./activity";
import type { ChatEvent, ChatMessage } from "./chat";
import { actorPair, joinNames, pairName } from "./task";

/**
 * Chat's feed worded on the server (v1.8 V5b E): each message and event with its IST day, the
 * day divider's words and its time, so the browser only orders and groups (`chat.ts`). Used by the
 * task page for the latest page and by "Load earlier" for each page before it.
 */

/** The day divider: "Today", "Yesterday", "Mon 20 Oct" (with the year when it is another year). */
export function chatDayLabel(day: ISODate, today: ISODate): string {
  if (day === today) return "Today";
  if (day === addISTDays(today, -1)) return "Yesterday";
  const noon = `${day}T12:00:00+05:30`;
  return day.slice(0, 4) === today.slice(0, 4)
    ? formatIST(noon, "EEE d MMM")
    : formatIST(noon, "EEE d MMM yyyy");
}

function moment(at: string, today: ISODate) {
  const day = toISTDate(at);
  return {
    at,
    atMs: Date.parse(at),
    day,
    dayLabel: chatDayLabel(day, today),
    time: formatTime(at),
  };
}

/** "Asha Rao" → "AR"; one name → its first letter. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export type ChatPeople = {
  viewerId: string;
  names: Readonly<Record<string, string>>;
  /** Each person's photo (a file id), when they have one. */
  photos: Readonly<Record<string, string | null>>;
  today: ISODate;
};

/** The comments (oldest first) as Chat's messages: "You" for the reader's own. */
export function chatMessages(
  comments: readonly {
    id: string;
    authorId: string;
    onBehalfOf: string | null;
    body: string;
    createdAt: string;
  }[],
  people: ChatPeople,
): ChatMessage[] {
  return comments.map((comment) => {
    const own = comment.authorId === people.viewerId;
    const forName = comment.onBehalfOf
      ? (people.names[comment.onBehalfOf] ?? "a freelancer")
      : null;
    const writer = people.names[comment.authorId] ?? "Someone";
    return {
      ...moment(comment.createdAt, people.today),
      id: comment.id,
      authorKey: `${comment.authorId}|${comment.onBehalfOf ?? ""}`,
      author: own
        ? actorPair("You", forName)
        : pairName(people.names, comment.authorId, comment.onBehalfOf),
      own,
      photo: people.photos[comment.authorId] ?? null,
      initials: initialsOf(writer),
      body: comment.body,
    };
  });
}

/**
 * The task's small events, as Chat's quiet lines (the approved sample): someone noted the task,
 * the deadline moved, a reminder went out (B6: a reminder is a notification, never a chat
 * message; the line only says it was sent). Everything else stays in History only.
 */
export function chatEvents(
  activity: readonly TaskActivityEntry[],
  people: Omit<ChatPeople, "photos">,
): ChatEvent[] {
  const actor = (entry: TaskActivityEntry) => {
    if (entry.actorId && entry.actorId === people.viewerId) {
      const forName = entry.onBehalfOfId
        ? (people.names[entry.onBehalfOfId] ?? "a freelancer")
        : null;
      return actorPair("You", forName);
    }
    return pairName(people.names, entry.actorId, entry.onBehalfOfId);
  };
  const events: ChatEvent[] = [];
  for (const entry of activity) {
    const text = eventText(entry, actor(entry), people.names);
    if (text) events.push({ ...moment(entry.at, people.today), id: String(entry.id), text });
  }
  return events.sort((a, b) => a.atMs - b.atMs);
}

function eventText(
  entry: TaskActivityEntry,
  actor: string,
  names: Readonly<Record<string, string>>,
): string | null {
  if (entry.entity === "task_assignees" && entry.action === "acknowledged") {
    return `${actor} noted the task · ${formatTime(entry.at)}`;
  }
  if (entry.entity !== "tasks") return null;
  if (entry.action === "reminder_sent") {
    const ids = Array.isArray(entry.meta.recipients) ? entry.meta.recipients : [];
    const who = joinNames(
      ids.map((id) => (typeof id === "string" ? (names[id] ?? "someone") : "someone")),
    );
    const sent = who ? `sent ${who} a reminder` : "sent a reminder";
    return `${actor} ${sent} · ${formatTime(entry.at)}`;
  }
  if (entry.action === "updated") {
    const fields = Array.isArray(entry.meta.fields) ? entry.meta.fields : Object.keys(entry.new);
    const due = entry.new.due_at;
    if (!fields.includes("due_at") || typeof due !== "string" || !due) return null;
    const by = actor === "You" ? "you" : actor;
    return `Deadline moved to ${formatIST(due, "EEE d MMM")}, ${formatTime(due)} by ${by}`;
  }
  return null;
}
