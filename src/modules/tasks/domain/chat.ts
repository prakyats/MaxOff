/**
 * A task's Chat as a conversation (v1.8 V5b E, the approved sample
 * `docs/design/v18-task-chat-sample.html`): the messages and the task's small events in one feed,
 * divided by day, with the "New" line at the first unread message, and consecutive messages by one
 * person within five minutes grouped under one name and photo, the time once at the group's end.
 *
 * Pure and client-safe (no date library): every date and time arrives already worded by the
 * server (`chat-feed.ts`), so the browser only orders and groups what it holds, including earlier
 * pages loaded with "Load earlier".
 */

/** How close consecutive messages by one person must be to share a group. */
export const GROUP_GAP_MS = 5 * 60_000;

/** How many messages a page of Chat holds: the latest on opening, then each "Load earlier". */
export const CHAT_PAGE = 50;

/** What every feed item carries about its moment, worded on the server in IST. */
type Moment = {
  /** The instant (ISO), for keys and `<time dateTime>`. */
  at: string;
  /** Epoch milliseconds, for ordering and the five-minute rule. */
  atMs: number;
  /** The IST day (`YYYY-MM-DD`). */
  day: string;
  /** The day as the divider says it: "Today", "Yesterday", "Mon 20 Oct". */
  dayLabel: string;
  /** "7:58 pm". */
  time: string;
};

/**
 * Who wrote a message, for their photo (`PersonAvatar`): their id (their colour), their name (the
 * initials) and their photo's file id, all from the directory read that names them (V5b-D).
 */
export type ChatFace = { id: string; name: string; avatarFileId: string | null };

/** One message, as Chat draws it. */
export type ChatMessage = Moment & {
  id: string;
  /** Who wrote it, by id ("<author>|<for>"): only the same pair shares a group. */
  authorKey: string;
  /** "Asha", "Ravi for Asha", or "You" for the reader. */
  author: string;
  own: boolean;
  /** The writer's photo, or their initials without one. */
  face: ChatFace;
  body: string;
};

/** A small task event (noted, deadline moved, reminder sent): a quiet centred line. */
export type ChatEvent = Moment & { id: string; text: string };

export type ChatGroup = {
  kind: "group";
  key: string;
  own: boolean;
  author: string;
  face: ChatFace;
  messages: ChatMessage[];
  /** The last message's time, shown once at the group's end. */
  time: string;
  at: string;
};

export type ChatRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "new"; key: string }
  | { kind: "event"; key: string; event: ChatEvent }
  | ChatGroup;

/**
 * The feed's rows, oldest first. `newFrom` is the first unread message's id (the red "New" line
 * goes just before it). Events older than the oldest message held are left out while earlier
 * messages are still to load (`complete` false), so an event never sits above messages it came
 * after; once the whole conversation is held, every event shows.
 */
export function chatRows(
  messages: readonly ChatMessage[],
  events: readonly ChatEvent[],
  options: { newFrom: string | null; complete: boolean },
): ChatRow[] {
  const oldest = messages.reduce<number>((min, message) => Math.min(min, message.atMs), Infinity);
  const shownEvents =
    options.complete || messages.length === 0
      ? events
      : events.filter((event) => event.atMs >= oldest);
  const items = [
    ...messages.map((message) => ({ kind: "message" as const, item: message })),
    ...shownEvents.map((event) => ({ kind: "event" as const, item: event })),
  ].sort(
    (a, b) => a.item.atMs - b.item.atMs || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1),
  );

  const rows: ChatRow[] = [];
  let day: string | null = null;
  let group: ChatGroup | null = null;
  for (const entry of items) {
    const { item } = entry;
    if (item.day !== day) {
      day = item.day;
      group = null;
      rows.push({ kind: "day", key: `day-${item.day}`, label: item.dayLabel });
    }
    if (entry.kind === "event") {
      group = null;
      rows.push({ kind: "event", key: `event-${entry.item.id}`, event: entry.item });
      continue;
    }
    const message = entry.item;
    if (message.id === options.newFrom) {
      group = null;
      rows.push({ kind: "new", key: "new" });
    }
    const last = group?.messages[group.messages.length - 1];
    if (
      group &&
      last &&
      last.authorKey === message.authorKey &&
      message.atMs - last.atMs <= GROUP_GAP_MS
    ) {
      group.messages.push(message);
      group.time = message.time;
      group.at = message.at;
      continue;
    }
    group = {
      kind: "group",
      key: `group-${message.id}`,
      own: message.own,
      author: message.author,
      face: message.face,
      messages: [message],
      time: message.time,
      at: message.at,
    };
    rows.push(group);
  }
  return rows;
}

/**
 * Earlier messages joined to those held, oldest first, each once (a page and a refresh may both
 * hold one).
 */
export function mergeMessages(
  earlier: readonly ChatMessage[],
  latest: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...earlier, ...latest]) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
}

/** The first unread message: by someone else, after the reader's last read. Null when none. */
export function firstUnreadId(
  comments: readonly { id: string; authorId: string; createdAt: string }[],
  lastReadAt: string | null,
  viewerId: string,
): string | null {
  const after = lastReadAt === null ? Number.NEGATIVE_INFINITY : Date.parse(lastReadAt);
  const first = comments.find(
    (comment) => comment.authorId !== viewerId && Date.parse(comment.createdAt) > after,
  );
  return first?.id ?? null;
}
