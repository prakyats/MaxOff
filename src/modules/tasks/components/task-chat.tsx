"use client";

import { ChevronLeftIcon, Maximize2Icon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type CSSProperties,
  type RefObject,
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
import { chatSpace, enlargedTitle, notedLine } from "../domain/chat-space";
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
  /** Their Task Noted, for the head's key line once the People card has scrolled away. */
  noted: boolean;
  /** The reader. */
  self: boolean;
};

/**
 * A task's Chat as a conversation (Kickoff 4 decisions 27, 28, 32; v1.8 V5b E, the approved
 * sample `docs/design/v18-task-chat-sample.html`). **Laptop** (and the task chat height sample,
 * `docs/design/v18-task-chat-height-sample.html`, owner 23 Oct): a dedicated panel under the
 * views' bar that fills the screen to its foot and scrolls inside itself, with the composer
 * pinned at its foot; as the page scrolls the header goes, the bar sticks and the panel grows to
 * fill the screen under it (`useChatSpace`); ⤢ at its head's right end enlarges it over the dimmed page (an
 * overlay layer: back, Esc and ✕ close it, the page is where it was). **Phone:** a full-height view
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
  enlargedLine,
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
  /** The enlarged chat's second line: "In progress · Overdue 4 days". */
  enlargedLine: string;
}) {
  const {
    desktop,
    chatOpen,
    setChatOpen,
    enlarged,
    setEnlarged,
    stuck,
    chatVisible,
    unread,
    markSeen,
  } = useTaskView();
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
  // The laptop's ⤢: the feed and the composer move into the large panel while it is open (the
  // feed is drawn in one place at a time).
  const big = desktop === true && enlarged;
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
      solid={phone || big || solidSend}
      placeholder={placeholder}
    />
  );
  // The large chat has no Radix trigger, so focus is handed back to ⤢ by hand on closing.
  const enlargeRef = useRef<HTMLButtonElement>(null);
  const typing = isKeyboardOpen(keyboard);
  const [spaceRef, panelRef] = useChatSpace(desktop === true && chatVisible && !big);

  return (
    <>
      <TaskViewPanel name="chat" className="gap-0">
        {/* The room the page keeps for the panel once the bar is stuck (`useChatSpace`). */}
        <div ref={spaceRef} data-slot="task-chat-space" className="flex min-w-0 flex-col">
          <div
            ref={panelRef}
            data-slot="task-chat-panel"
            className="bg-card border-border shadow-raised rounded-sheet flex h-[max(20rem,calc(100dvh-22rem))] min-h-0 min-w-0 flex-col overflow-hidden border"
          >
            {phone ? null : (
              <>
                <ChatHead
                  people={people}
                  stuck={stuck}
                  enlargeRef={enlargeRef}
                  onEnlarge={() => setEnlarged(true)}
                />
                {big ? (
                  <div className="min-h-0 flex-1" />
                ) : (
                  <>
                    {feed}
                    <div
                      data-slot="task-chat-composer-row"
                      className="bg-card border-t px-3 pt-2.5 pb-2"
                    >
                      {composer}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </TaskViewPanel>

      {/* ⤢ on a laptop: the chat as a large panel over the dimmed page (the sample's "Enlarged
          chat"). An overlay layer: back, Esc and ✕ close it, and the page is where it was. */}
      <Sheet open={big} onOpenChange={setEnlarged}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          followKeyboard={false}
          data-slot="task-chat-enlarged"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            enlargeRef.current?.focus();
          }}
          aria-describedby="task-chat-enlarged-description"
          className="bg-card border-border rounded-sheet mx-auto max-w-6xl gap-0 overflow-hidden border p-0 shadow-lg data-[side=bottom]:inset-x-15 data-[side=bottom]:top-6 data-[side=bottom]:bottom-6 data-[side=bottom]:h-auto"
        >
          <SheetHeader className="border-border flex-row items-center gap-2.5 border-b py-1.5 pr-1.5 pl-4">
            <ChatFaces people={people} />
            <div className="flex min-w-0 flex-1 flex-col">
              <SheetTitle className="truncate text-sm font-semibold">
                {enlargedTitle(taskTitle, people)}
              </SheetTitle>
              <SheetDescription
                id="task-chat-enlarged-description"
                className="text-muted-foreground truncate text-xs"
              >
                {enlargedLine}
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                data-slot="task-chat-enlarged-close"
                className="size-11"
                aria-label="Close the large chat"
              >
                <XIcon aria-hidden className="size-5" />
              </Button>
            </SheetClose>
          </SheetHeader>
          {big ? feed : null}
          <div data-slot="task-chat-composer-row" className="bg-card border-t px-3 pt-2.5 pb-2">
            {big ? composer : null}
          </div>
        </SheetContent>
      </Sheet>

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

/** The people's photos, up to three, overlapping (the sample's chat head). */
function ChatFaces({ people }: { people: ChatPerson[] }) {
  if (people.length === 0) return null;
  return (
    <div aria-hidden className="flex shrink-0 -space-x-1.5">
      {people.slice(0, 3).map((person) => (
        <span key={person.id} className="ring-card rounded-full ring-2">
          <PersonAvatar person={person.face} size={28} />
        </span>
      ))}
    </div>
  );
}

/**
 * The laptop panel's head (the sample): the people's photos, their names, who sees the chat, and
 * at its right end ⤢ (44 px, neutral), which enlarges the chat over the dimmed page; it lives here,
 * not on the Work | Chat bar, so it shows only while Chat is open (issue #89). The large chat
 * returns focus to it on closing. Once the bar is stuck and the People card has scrolled away with
 * the header, the names carry its key line ("Asha · Noted"; task chat height).
 */
function ChatHead({
  people,
  stuck,
  enlargeRef,
  onEnlarge,
}: {
  people: ChatPerson[];
  stuck: boolean;
  enlargeRef: RefObject<HTMLButtonElement | null>;
  onEnlarge: () => void;
}) {
  const noted = stuck ? notedLine(people) : null;
  return (
    <div
      data-slot="task-chat-head"
      // The 44 px ⤢ sets the head's height (56 px, as the two lines with their padding did).
      className="border-border flex min-w-0 items-center gap-2.5 border-b py-1.5 pr-1.5 pl-4"
    >
      <ChatFaces people={people} />
      <div className="flex min-w-0 flex-1 flex-col">
        {people.length > 0 ? (
          <p className="text-sm font-semibold break-words">
            {people.map((person) => person.name).join(", ")}
            {noted ? <span data-slot="task-chat-head-noted">{` · ${noted}`}</span> : null}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">Everyone on the task sees this chat</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        ref={enlargeRef}
        data-slot="task-chat-enlarge"
        aria-label="Enlarge the chat"
        title="Enlarge the chat"
        aria-haspopup="dialog"
        className="text-muted-foreground size-11 shrink-0"
        onClick={onEnlarge}
      >
        <Maximize2Icon aria-hidden />
      </Button>
    </div>
  );
}

/**
 * The laptop's chat space (task chat height, owner 23 Oct): the panel runs from where it starts
 * to the screen's foot, so the composer is always pinned in view, and grows as the page scrolls
 * and the header goes, until the Work | Chat bar is stuck; the space under it keeps the stuck
 * height, so the page scrolls exactly that far (`chatSpace`). Written straight to the two
 * elements once a frame (no render per scroll); CSS gives a close first guess before this runs.
 */
function useChatSpace(
  active: boolean,
): [RefObject<HTMLDivElement | null>, RefObject<HTMLDivElement | null>] {
  const spaceRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const space = spaceRef.current;
    const panel = panelRef.current;
    if (!active || !space || !panel) return;
    const root = document.documentElement;
    const band = document.querySelector<HTMLElement>('[data-slot="task-tabs-band"]');
    let frame = 0;
    const measure = () => {
      frame = 0;
      const style = getComputedStyle(root);
      // The bands fixed at the screen's foot (offline, notifications off) cover the page's end.
      const bands =
        (Number.parseFloat(style.getPropertyValue("--app-offline-h")) || 0) +
        (Number.parseFloat(style.getPropertyValue("--app-push-h")) || 0);
      const column = band?.parentElement;
      const gap = column ? Number.parseFloat(getComputedStyle(column).rowGap) || 0 : 0;
      const stuckTop = band
        ? (Number.parseFloat(getComputedStyle(band).top) || 0) + band.offsetHeight + gap
        : 0;
      const { panel: height, reserve } = chatSpace({
        viewport: window.innerHeight,
        panelTop: space.getBoundingClientRect().top,
        stuckTop,
        bands,
        foot: PANEL_FOOT_PX,
        min: PANEL_MIN_PX,
      });
      space.style.height = `${reserve}px`;
      panel.style.height = `${height}px`;
    };
    const soon = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", soon);
    window.addEventListener("scroll", soon, { passive: true });
    const bandsChange = new MutationObserver(soon);
    bandsChange.observe(root, { attributes: true, attributeFilter: ["style"] });
    // Whatever above the panel changes height (a Remind that starts waiting, a callout that
    // wraps, the next step answering) moves where it starts; a band arriving at the foot pads
    // the page's main (`--app-bands-h`), which resizes it.
    const above = new ResizeObserver(soon);
    for (const node of document.querySelectorAll(
      '#main, [data-slot="page-header"], [data-slot="task-summary"], [data-slot="task-tabs-band"]',
    )) {
      above.observe(node);
    }
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("resize", soon);
      window.removeEventListener("scroll", soon);
      bandsChange.disconnect();
      above.disconnect();
      space.style.removeProperty("height");
      panel.style.removeProperty("height");
    };
  }, [active]);
  return [spaceRef, panelRef];
}

/** The sheet ends where the keyboard begins and is as tall as what is still visible. */
function keyboardPlacement(inset: number, height: number): CSSProperties {
  return { bottom: `${inset}px`, height: `${height}px` };
}
