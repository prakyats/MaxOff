"use client";

import { ArrowDownIcon } from "lucide-react";
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/core/lib/utils";
import { PersonAvatar } from "@/core/ui/composites/person-avatar";
import { Button } from "@/core/ui/primitives/button";

import { type ChatEvent, type ChatGroup, type ChatMessage, chatRows } from "../domain/chat";

import { LinkedText } from "./linked-text";

/** Within this many pixels of the foot, the reader is "at the latest" and new messages follow. */
const NEAR_FOOT_PX = 48;

/**
 * Chat's feed (v1.8 V5b E, the approved sample): its own scroller, the day dividers, the red
 * "New" line, the task's quiet event lines and the grouped bubbles, "Load earlier" at the top.
 *
 * **Where it opens:** each time it comes into view, at the "New" line when something is unread,
 * otherwise at the latest. **A message arriving** (the page's refresh path re-reads it) follows to
 * the foot when the reader is there or wrote it; scrolled up, it shows "Jump to latest" instead.
 * **Load earlier** keeps the message the reader was on where it was.
 */
export function ChatFeed({
  messages,
  events,
  more,
  newFrom,
  visible,
  loadingEarlier,
  earlierError,
  onLoadEarlier,
  className,
}: {
  /** Every message held, oldest first. */
  messages: readonly ChatMessage[];
  events: readonly ChatEvent[];
  /** Earlier messages remain to load. */
  more: boolean;
  /** The first unread message's id: the "New" line goes before it. */
  newFrom: string | null;
  /** Chat is in front of the reader now. */
  visible: boolean;
  loadingEarlier: boolean;
  earlierError: boolean;
  onLoadEarlier: () => void;
  className?: string;
}) {
  const rows = useMemo(
    () => chatRows(messages, events, { newFrom, complete: !more }),
    [messages, events, newFrom, more],
  );
  const scroller = useRef<HTMLDivElement | null>(null);
  const atFoot = useRef(true);
  const [jump, setJump] = useState(false);

  const toFoot = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    atFoot.current = true;
    setJump(false);
  }, []);

  // Opening: at the "New" line, else the latest; again each time Chat comes back into view.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (!visible) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    const node = scroller.current;
    if (!node || node.clientHeight === 0) return;
    opened.current = true;
    const line = node.querySelector<HTMLElement>('[data-slot="chat-new-line"]');
    if (line) {
      node.scrollTop = Math.max(0, line.offsetTop - 8);
      atFoot.current = node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_FOOT_PX;
    } else {
      toFoot();
    }
  }, [visible, rows, toFoot]);

  // A new latest message: follow it at the foot (or one's own), otherwise offer the jump.
  const latest = messages[messages.length - 1];
  const latestId = useRef(latest?.id ?? null);
  useLayoutEffect(() => {
    const id = latest?.id ?? null;
    if (id === latestId.current) return;
    latestId.current = id;
    if (!opened.current) return;
    if (latest?.own || atFoot.current) toFoot();
    else setJump(true);
  }, [latest, toFoot]);

  // Load earlier: the page grows above; the message on screen stays where it was.
  const oldestId = messages[0]?.id ?? null;
  const before = useRef<{ id: string | null; height: number; top: number }>({
    id: oldestId,
    height: 0,
    top: 0,
  });
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (before.current.id !== oldestId && before.current.height > 0) {
      node.scrollTop = before.current.top + (node.scrollHeight - before.current.height);
    }
    before.current = { id: oldestId, height: 0, top: 0 };
  }, [oldestId]);
  const loadEarlier = () => {
    const node = scroller.current;
    if (node) before.current = { id: oldestId, height: node.scrollHeight, top: node.scrollTop };
    onLoadEarlier();
  };

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={scroller}
        data-slot="task-chat-thread"
        onScroll={(event) => {
          const node = event.currentTarget;
          atFoot.current = node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_FOOT_PX;
          if (atFoot.current && jump) setJump(false);
        }}
        className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {more ? (
          <div className="flex flex-col items-center gap-1 pb-2">
            <Button
              type="button"
              variant="ghost"
              data-slot="chat-load-earlier"
              className="text-muted-foreground min-h-11 rounded-full px-4"
              pending={loadingEarlier}
              pendingLabel="Loading…"
              onClick={loadEarlier}
            >
              Load earlier
            </Button>
            {earlierError ? (
              <p role="alert" className="text-muted-foreground text-xs">
                Couldn&apos;t load earlier messages. Try again.
              </p>
            ) : null}
          </div>
        ) : null}
        {rows.map((row) => (
          <Fragment key={row.key}>{rowView(row)}</Fragment>
        ))}
        {messages.length === 0 ? (
          <p
            className="text-muted-foreground my-auto px-6 py-8 text-center text-sm"
            data-slot="task-comments-empty"
          >
            No messages yet. Ask a question or post an update: everyone on the task sees it.
          </p>
        ) : null}
      </div>
      {jump ? (
        <Button
          type="button"
          variant="secondary"
          data-slot="chat-jump"
          onClick={toFoot}
          className="bg-surface-3 shadow-floating absolute right-4 bottom-3 min-h-11 rounded-full px-4"
        >
          <ArrowDownIcon aria-hidden />
          Jump to latest
        </Button>
      ) : null}
    </div>
  );
}

function rowView(row: ReturnType<typeof chatRows>[number]) {
  switch (row.kind) {
    case "day":
      return (
        <p
          data-slot="chat-day"
          className="text-muted-foreground before:bg-border after:bg-border mt-2.5 mb-2 flex items-center gap-2.5 text-xs font-semibold before:h-px before:flex-1 after:h-px after:flex-1"
        >
          {row.label}
        </p>
      );
    case "new":
      return (
        <p
          data-slot="chat-new-line"
          className="text-danger after:bg-brand my-2 flex items-center gap-2.5 text-xs font-semibold after:h-px after:flex-1"
        >
          New
        </p>
      );
    case "event":
      return (
        <p
          data-slot="chat-event"
          className="text-muted-foreground bg-surface-2 border-border my-2 self-center rounded-full border px-2.5 py-0.5 text-center text-xs break-words"
        >
          {row.event.text}
        </p>
      );
    case "group":
      return <GroupView group={row} />;
  }
}

function GroupView({ group }: { group: ChatGroup }) {
  const { own } = group;
  return (
    <div
      data-slot="chat-group"
      data-own={own ? "true" : "false"}
      className={cn(
        "mt-2 flex max-w-[75%] min-w-0 items-end gap-2",
        own ? "flex-row-reverse self-end" : "self-start",
      )}
    >
      {own ? null : <PersonAvatar person={group.face} size={28} />}
      <div className={cn("flex min-w-0 flex-col gap-0.5", own && "items-end")}>
        {/* Others by name; one's own only when written for a freelancer ("You for Asha"). */}
        {own && group.author === "You" ? null : (
          <p
            aria-hidden
            className={cn("text-muted-foreground mb-0.5 text-xs", own ? "mr-2.5" : "ml-2.5")}
          >
            {group.author}
          </p>
        )}
        {group.messages.map((message) => (
          <div
            key={message.id}
            data-slot="task-comment"
            data-own={own ? "true" : "false"}
            className={cn(
              "rounded-bubble w-max max-w-full min-w-0 px-3 py-2 text-sm",
              own
                ? "bg-primary text-primary-foreground [&_a]:text-primary-foreground rounded-r-control first-of-type:rounded-tr-bubble"
                : // The sample's raised surface; on the laptop panel's white card (light) it would vanish,
                  // so a muted fill there (DESIGN §Decisions, sample fidelity flags).
                  "bg-surface-3 md:bg-muted md:dark:bg-surface-3 text-foreground rounded-l-control first-of-type:rounded-tl-bubble",
            )}
          >
            <span className="sr-only">
              {message.author}, {message.time}:{" "}
            </span>
            <LinkedText text={message.body} />
          </div>
        ))}
        <time
          aria-hidden
          dateTime={group.at}
          className="text-muted-foreground mx-2.5 mt-0.5 text-xs"
        >
          {group.time}
        </time>
      </div>
    </div>
  );
}
