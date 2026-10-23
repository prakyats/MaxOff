"use client";

import { ChevronLeftIcon } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { getInBackground, postInBackground } from "@/core/http/background";
import { PersonAvatar } from "@/core/ui/composites/person-avatar";
import { Button } from "@/core/ui/primitives/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/primitives/sheet";
import { isKeyboardOpen } from "@/core/ui/viewport/keyboard";
import { useKeyboard } from "@/core/ui/viewport/use-keyboard";

import { type ChatEvent, type ChatFace, type ChatMessage, mergeMessages } from "../domain/chat";
import { WRITING_AS_SELF } from "../domain/page";

import { ChatFeed } from "./task-chat-feed";
import { ChatComposerSkeleton } from "./task-chat-skeleton";
import { taskReads } from "./task-reads";
import { TaskViewPanel, useTaskView } from "./task-view";

/**
 * The composer (a form with a select and the post action) loads after the page, not in its
 * first-load JavaScript (ARCHITECTURE §19); its skeleton traces it meanwhile (decision 31).
 */
const ChatComposer = dynamic(
  () => import("./task-chat-composer").then((module) => module.ChatComposer),
  { ssr: false, loading: () => <ChatComposerSkeleton /> },
);

/** Below the panel on a laptop: the page's own foot padding. */
const PANEL_FOOT_PX = 24;
/** The panel never gets shorter than this on a short laptop screen (the page scrolls then). */
const PANEL_MIN_PX = 320;

/** Who the chat is with, for its head: the people on the task. */
export type ChatPerson = {
  id: string;
  /** "Asha", or "You" for the reader. */
  name: string;
  /** Their photo or initials, from the directory read that names them (V5b-D). */
  face: ChatFace;
};

/**
 * A task's Chat as a conversation (Kickoff 4 decisions 27, 28, 32; v1.8 V5b E, the approved
 * sample `docs/design/v18-task-chat-sample.html`). **Laptop:** a dedicated panel under the views'
 * bar that fills the screen to its foot and scrolls inside itself (the task's header, state and
 * views never scroll away), with the composer pinned at its foot. **Phone:** a full-height view
 * (a layer: back returns to the task, ARCHITECTURE §14.2 a) with the composer above the on-screen
 * keyboard (`visualViewport`). The feed (`ChatFeed`) is drawn in one place at a time.
 *
 * **Fast (V5b E item 7):** the page holds the latest 50 messages; "Load earlier" reads the page
 * before the oldest held (`/api/tasks/comments`, keyset). Every page held is kept, so a refresh
 * (the page's existing refresh path: a new message's notification, or one's own send) only adds
 * the new ones.
 *
 * **Read tracking:** having Chat in front of you (the view, or the open sheet) marks it read up
 * to the newest comment shown (`task_mark_read`, the viewer's own row), whenever something is
 * unread; the count on the tab goes at once. The red "New" line stays where it was while Chat is
 * open and goes once it has been left. Comments stay open in every state, locked or not
 * (WORKFLOWS §3.1); a freelancer's coordinator writes as themselves or for them (ADR-0013).
 */
export function TaskChat({
  taskId,
  taskTitle,
  messages: latest,
  events,
  more: latestMore,
  firstUnread,
  newestAt,
  people,
  solidSend,
  placeholder,
  forOptions,
  defaultFor,
}: {
  taskId: string;
  taskTitle: string;
  /** The latest page of messages, worded on the server. */
  messages: ChatMessage[];
  events: ChatEvent[];
  /** Earlier messages remain before the latest page. */
  more: boolean;
  /** The first unread message on opening. */
  firstUnread: string | null;
  newestAt: string | null;
  /** The people on the task, for the laptop panel's head ("Asha, You"). */
  people: ChatPerson[];
  /** On a laptop, Send may be the screen's one solid commit (no next step's solid beside it). */
  solidSend: boolean;
  placeholder: string;
  /** The freelancers on this task the viewer coordinates now. */
  forOptions: { id: string; name: string }[];
  /** Who a comment is for by default: null = the viewer themselves. */
  defaultFor: string | null;
}) {
  const { desktop, chatOpen, setChatOpen, chatVisible, unread, markSeen } = useTaskView();
  const keyboard = useKeyboard();
  // The draft lives here, outside the sheet and the lazy composer: a back keeps what was typed.
  const [body, setBody] = useState("");
  const [writingFor, setWritingFor] = useState<string>(defaultFor ?? WRITING_AS_SELF);
  const marked = useRef<string | null>(null);

  useEffect(() => {
    if (!chatVisible || unread === 0 || newestAt === null || marked.current === newestAt) return;
    marked.current = newestAt;
    markSeen(newestAt);
    // In the background, re-reading nothing (owner decision 2026-10-01): the lists drawn before it
    // re-read themselves when shown again. A failed mark leaves the count for the next visit. A
    // plain request, never a server action (ARCHITECTURE §4.4): this effect can run while a
    // navigation is in flight, and an action sent then would hold the new page.
    taskReads.changed();
    void postInBackground<null>("/api/tasks/read", { taskId, upTo: newestAt });
  }, [chatVisible, unread, newestAt, taskId, markSeen]);

  // Every page held: earlier pages, and each latest page a refresh brought (comments are never
  // deleted, so nothing held goes stale). Follows the props as they change.
  const [held, setHeld] = useState<ChatMessage[]>(latest);
  const [heldLatest, setHeldLatest] = useState(latest);
  if (heldLatest !== latest) {
    setHeldLatest(latest);
    setHeld(mergeMessages(held, latest));
  }
  const [more, setMore] = useState(latestMore);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState(false);
  const loadEarlier = useCallback(() => {
    const oldest = held[0];
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    setEarlierError(false);
    void getInBackground<{ messages: ChatMessage[]; more: boolean }>("/api/tasks/comments", {
      task: taskId,
      before: oldest.at,
      id: oldest.id,
    }).then((result) => {
      setLoadingEarlier(false);
      if (!result.ok) {
        setEarlierError(true);
        return;
      }
      setHeld((current) => mergeMessages(result.data.messages, current));
      setMore(result.data.more);
    });
  }, [held, loadingEarlier, taskId]);

  // The "New" line: where the unread began when Chat opened. It stays while Chat is in front of
  // the reader and goes once they leave it; a message arriving while Chat is away moves it.
  const [newFrom, setNewFrom] = useState(firstUnread);
  const [seenUnread, setSeenUnread] = useState(firstUnread);
  const [wasVisible, setWasVisible] = useState(chatVisible);
  if (wasVisible !== chatVisible) {
    setWasVisible(chatVisible);
    if (!chatVisible) setNewFrom(null);
  }
  if (!chatVisible && firstUnread !== seenUnread) {
    setSeenUnread(firstUnread);
    setNewFrom(firstUnread);
  }

  const phone = desktop === false;
  const feed = (
    <ChatFeed
      messages={held}
      events={events}
      more={more}
      newFrom={newFrom}
      visible={chatVisible}
      loadingEarlier={loadingEarlier}
      earlierError={earlierError}
      onLoadEarlier={loadEarlier}
    />
  );
  const composer = (
    <ChatComposer
      taskId={taskId}
      body={body}
      onBodyChange={setBody}
      writingFor={writingFor}
      onWritingForChange={setWritingFor}
      forOptions={forOptions}
      solid={phone || solidSend}
      placeholder={placeholder}
    />
  );
  const typing = isKeyboardOpen(keyboard);
  const [setPanel, panelHeight] = usePanelHeight(desktop === true && chatVisible);

  return (
    <>
      <TaskViewPanel name="chat" className="gap-0">
        <div
          ref={setPanel}
          data-slot="task-chat-panel"
          style={panelHeight === null ? undefined : { height: panelHeight }}
          className="bg-card border-border shadow-raised rounded-sheet flex h-[max(20rem,calc(100dvh-22rem))] min-h-0 min-w-0 flex-col overflow-hidden border"
        >
          {phone ? null : (
            <>
              <ChatHead people={people} />
              {feed}
              <div data-slot="task-chat-composer-row" className="bg-card border-t px-3 pt-2.5 pb-2">
                {composer}
              </div>
            </>
          )}
        </div>
      </TaskViewPanel>

      <Sheet open={phone && chatOpen} onOpenChange={setChatOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // It places itself over the keyboard, full height (`keyboardPlacement`).
          followKeyboard={false}
          data-slot="task-chat-sheet"
          aria-describedby="task-chat-sheet-description"
          className="bg-background gap-0 rounded-none p-0 pt-[var(--app-safe-top)] data-[side=bottom]:h-dvh"
          style={typing ? keyboardPlacement(keyboard.inset, keyboard.height) : undefined}
        >
          <SheetHeader className="flex-row items-center gap-1 border-b py-0 pr-4 pl-1">
            <SheetClose asChild>
              <Button variant="ghost" size="icon" className="size-11" aria-label="Back to the task">
                <ChevronLeftIcon aria-hidden className="size-5" />
              </Button>
            </SheetClose>
            <div className="flex min-h-11 min-w-0 flex-1 items-center">
              {/* One line: back opens the task, where the whole title shows. */}
              <SheetTitle className="truncate">{taskTitle} · Chat</SheetTitle>
              <SheetDescription id="task-chat-sheet-description" className="sr-only">
                The task&apos;s messages, and yours.
              </SheetDescription>
            </div>
          </SheetHeader>
          {phone ? feed : null}
          <div
            data-slot="task-chat-composer-row"
            // The sample's raised bar: the card's surface over the feed, a hairline above it.
            className="bg-card border-border border-t px-3 pt-2.5 pb-[calc(0.625rem+var(--app-safe-bottom))] data-[typing=true]:pb-2.5"
            data-typing={typing ? "true" : "false"}
          >
            {phone ? composer : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The laptop panel's head (the sample): the people's photos, their names, who sees the chat. */
function ChatHead({ people }: { people: ChatPerson[] }) {
  return (
    <div
      data-slot="task-chat-head"
      className="border-border flex min-w-0 items-center gap-2.5 border-b px-4 py-2.5"
    >
      {people.length > 0 ? (
        <div aria-hidden className="flex shrink-0 -space-x-1.5">
          {people.slice(0, 3).map((person) => (
            <span key={person.id} className="ring-card rounded-full ring-2">
              <PersonAvatar person={person.face} size={28} />
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col">
        {people.length > 0 ? (
          <p className="text-sm font-semibold break-words">
            {people.map((person) => person.name).join(", ")}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">Everyone on the task sees this chat</p>
      </div>
    </div>
  );
}

/**
 * The laptop panel fills the screen from where it starts to the page's foot, so the page itself
 * does not scroll and the task's header stays in view; CSS gives a close first guess before this
 * runs.
 */
function usePanelHeight(active: boolean): [(node: HTMLDivElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!active || !node) return;
    const root = document.documentElement;
    const measure = () => {
      const top = node.getBoundingClientRect().top + window.scrollY;
      // The bands fixed at the screen's foot (offline, notifications off) cover the page's end.
      const style = getComputedStyle(root);
      const bands =
        (Number.parseFloat(style.getPropertyValue("--app-offline-h")) || 0) +
        (Number.parseFloat(style.getPropertyValue("--app-push-h")) || 0);
      setHeight(
        Math.max(PANEL_MIN_PX, Math.floor(window.innerHeight - top - bands - PANEL_FOOT_PX)),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    const bandsChange = new MutationObserver(measure);
    bandsChange.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => {
      window.removeEventListener("resize", measure);
      bandsChange.disconnect();
    };
  }, [active, node]);
  return [setNode, height];
}

/** The sheet ends where the keyboard begins and is as tall as what is still visible. */
function keyboardPlacement(inset: number, height: number): CSSProperties {
  return { bottom: `${inset}px`, height: `${height}px` };
}
