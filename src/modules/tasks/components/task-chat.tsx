"use client";

import { XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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

import { markTaskRead } from "../actions/tasks";
import { taskReads } from "./task-reads";
import { WRITING_AS_SELF } from "../domain/page";

import { ChatComposerSkeleton } from "./task-chat-skeleton";
import { TaskViewPanel, useTaskView } from "./task-view";

/**
 * The composer (a form with a select and the post action) loads after the page, not in its
 * first-load JavaScript (ARCHITECTURE §19); its skeleton traces it meanwhile (decision 31).
 */
const ChatComposer = dynamic(
  () => import("./task-chat-composer").then((module) => module.ChatComposer),
  { ssr: false, loading: () => <ChatComposerSkeleton /> },
);

/** How far below the top of the screen the full-height sheet starts (the page shows above it). */
const SHEET_GAP = "0.75rem";

/**
 * A task's Chat (Kickoff 4 decisions 27, 28, 32): the comments, oldest first, and a composer at
 * the bottom. **Desktop:** a view like the others, inline. **Phone:** a full-height bottom sheet
 * (a layer: back closes it, ARCHITECTURE §14.2 a) with the thread scrolled to the newest and the
 * composer at the bottom, **kept above the on-screen keyboard** (`visualViewport`: the sheet
 * ends where the keyboard begins and is as tall as what is still visible). The thread is drawn in
 * one place at a time (inline until the layout is known, then the sheet on a phone).
 *
 * **Read tracking:** having Chat in front of you (the view, or the open sheet) marks it read up
 * to the newest comment shown (`task_mark_read`, the viewer's own row), whenever something is
 * unread; the count on the tab goes at once. Comments stay open in every state, locked or not
 * (WORKFLOWS §3.1); a freelancer's coordinator writes as themselves or for them (ADR-0013).
 */
export function TaskChat({
  taskId,
  thread,
  count,
  newestAt,
  forOptions,
  defaultFor,
}: {
  taskId: string;
  /** The comments, drawn on the server. */
  thread: ReactNode;
  count: number;
  newestAt: string | null;
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
    // re-read themselves when shown again. A failed mark leaves the count for the next visit.
    taskReads.changed();
    void markTaskRead({ taskId, upTo: newestAt });
  }, [chatVisible, unread, newestAt, taskId, markSeen]);

  // The thread opens on its newest comment, and follows a new one.
  const scroller = useRef<HTMLDivElement | null>(null);
  const toNewest = useCallback((node: HTMLDivElement | null) => {
    scroller.current = node;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [count]);

  const phone = desktop === false;
  const composer = (
    <ChatComposer
      taskId={taskId}
      body={body}
      onBodyChange={setBody}
      writingFor={writingFor}
      onWritingForChange={setWritingFor}
      forOptions={forOptions}
      inSheet={phone}
    />
  );
  const typing = isKeyboardOpen(keyboard);

  return (
    <>
      <TaskViewPanel name="chat" className="gap-4">
        {phone ? null : (
          <>
            {thread}
            <div data-slot="task-chat-composer-row">{composer}</div>
          </>
        )}
      </TaskViewPanel>

      <Sheet open={phone && chatOpen} onOpenChange={setChatOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          data-slot="task-chat-sheet"
          aria-describedby="task-chat-sheet-description"
          className="gap-0 rounded-t-2xl p-0 data-[side=bottom]:h-[calc(100dvh-var(--app-safe-top)-0.75rem)]"
          style={typing ? keyboardPlacement(keyboard.inset, keyboard.height) : undefined}
        >
          <SheetHeader className="flex-row items-center justify-between gap-2 border-b py-1 pr-1 pl-4">
            <div className="flex min-w-0 flex-col">
              <SheetTitle>Chat</SheetTitle>
              <SheetDescription id="task-chat-sheet-description" className="sr-only">
                The task&apos;s comments, and yours.
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" className="size-11" aria-label="Close chat">
                <XIcon aria-hidden />
              </Button>
            </SheetClose>
          </SheetHeader>
          <div
            ref={toNewest}
            data-slot="task-chat-thread"
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
          >
            {phone ? thread : null}
          </div>
          <div
            data-slot="task-chat-composer-row"
            className="border-t p-3 pb-[calc(0.75rem+var(--app-safe-bottom))] data-[typing=true]:pb-3"
            data-typing={typing ? "true" : "false"}
          >
            {phone ? composer : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** The sheet ends where the keyboard begins and is as tall as what is still visible. */
function keyboardPlacement(inset: number, height: number): CSSProperties {
  return { bottom: `${inset}px`, height: `calc(${height}px - ${SHEET_GAP})` };
}
