"use client";

import { Maximize2Icon } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/core/lib/utils";
import { markLive } from "@/core/ui/navigation/attributes";
import { Button } from "@/core/ui/primitives/button";
import { replaceViewAddress } from "@/core/ui/navigation/view-address";
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { useIsDesktop } from "@/core/ui/viewport/use-desktop";

import { barStuck } from "../domain/chat-space";
import { chatLabel, parseTaskView, shownView, type TaskView, viewQuery } from "../domain/page";

/** The dialogs of the task's work, opened from the next-step bar or from ⋯. */
export type StepDialog = "done" | "approve" | "reject" | "takeOver";

type TaskViewState = {
  /** The view chosen (the URL's `?tab=`); what a screen shows of it is `shownView`. */
  view: TaskView;
  choose: (view: TaskView) => void;
  /** Null until hydration: CSS draws the layout, this decides what a tap does. */
  desktop: boolean | null;
  /** The phone's Chat sheet (decision 28): a layer over the page, never a view. */
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  /**
   * The laptop's enlarged chat (⤢, task chat height, owner 23 Oct): a large panel over the dimmed
   * page, an overlay layer (back, Esc and ✕ close it, §14.2 a), never a view.
   */
  enlarged: boolean;
  setEnlarged: (open: boolean) => void;
  /** A laptop's Work | Chat bar is stuck under the top bar (the header has scrolled away). */
  stuck: boolean;
  /** The views' bar registers its band here, so the stuck state is the page's. */
  setBand: (node: HTMLDivElement | null) => void;
  /** Chat, whichever way this screen has it: the view on a desktop, the sheet on a phone. */
  openChat: () => void;
  /** Whether the viewer has Chat in front of them now (the view, the enlarged panel, the sheet). */
  chatVisible: boolean;
  /** The unread comments, gone as soon as Chat has been open (the server confirms on refresh). */
  unread: number;
  /** Chat marked read up to this comment (the newest shown): the unread count is gone. */
  markSeen: (upTo: string) => void;
  dialog: StepDialog | null;
  setDialog: (dialog: StepDialog | null) => void;
};

const TaskViewContext = createContext<TaskViewState | null>(null);

export function useTaskView(): TaskViewState {
  const state = useContext(TaskViewContext);
  if (!state) throw new Error("useTaskView() outside <TaskViewProvider>");
  return state;
}

/**
 * The task page's view state (Kickoff 4 decisions 27, 28, 32). The views (Work, Chat,
 * Details) are a **view control**: choosing one replaces the URL's `?tab=` (never a push, so one
 * back leaves the task whatever was chosen; ARCHITECTURE §14.2 d), and nothing ever switches it
 * but the viewer's tap: a refresh, an action's answer or a new comment leaves it where it is.
 * A task lands on Work (the list links carry no `tab`); a refresh or a shared link keeps the view.
 * A phone has no Chat view (Chat is a full-height sheet, a layer) and a desktop no Details view
 * (Details is the right panel): either falls back to Work there (`shownView`). A phone that
 * arrives on `?tab=chat` (a link to the conversation) opens the sheet once, over Work.
 */
export function TaskViewProvider({
  unread,
  newestAt,
  children,
}: {
  unread: number;
  /** The newest comment's time: once Chat has been open up to it, nothing is unread. */
  newestAt: string | null;
  children: ReactNode;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [view, setView] = useState<TaskView>(() => parseTaskView(params.get("tab")));
  const desktop = useIsDesktop();
  const [chatOpen, setChatOpen] = useState(false);
  const [enlarged, setEnlargedState] = useState(false);
  const [band, setBand] = useState<HTMLDivElement | null>(null);
  const stuck = useStuckBar(band, desktop === true);
  // The enlarged chat returns the reader to where they were on the page (task chat height).
  const scrollAt = useRef<number | null>(null);
  useEffect(() => {
    if (enlarged || scrollAt.current === null) return;
    const top = scrollAt.current;
    scrollAt.current = null;
    const frame = requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [enlarged]);
  const [seenUpTo, setSeenUpTo] = useState<string | null>(null);
  const [dialog, setDialog] = useState<StepDialog | null>(null);
  // A phone arriving on the conversation: the sheet opens once, as soon as the layout is known.
  const [arrived, setArrived] = useState(false);
  if (!arrived && desktop !== null) {
    setArrived(true);
    if (!desktop && view === "chat") setChatOpen(true);
  }

  const value = useMemo<TaskViewState>(() => {
    const choose = (next: TaskView) => {
      setView(next);
      // The page's own entry keeps the view: an overlay's spent entry is backed out first
      // (§14.1, as the list filters do), then the address is replaced (held while the router is
      // fetching: `view-address.ts`).
      closeOverlaysThen(() => {
        replaceViewAddress(`${pathname}${viewQuery(window.location.search, next)}`);
      });
    };
    const seen =
      seenUpTo !== null && newestAt !== null && Date.parse(newestAt) <= Date.parse(seenUpTo);
    return {
      view,
      choose,
      desktop,
      chatOpen,
      setChatOpen,
      enlarged,
      setEnlarged: (open: boolean) => {
        if (open && scrollAt.current === null) scrollAt.current = window.scrollY;
        setEnlargedState(open);
      },
      stuck,
      setBand,
      openChat: () => {
        if (window.matchMedia("(min-width: 768px)").matches) choose("chat");
        else setChatOpen(true);
      },
      chatVisible: desktop === true ? view === "chat" || enlarged : desktop === false && chatOpen,
      unread: seen ? 0 : unread,
      markSeen: setSeenUpTo,
      dialog,
      setDialog,
    };
  }, [view, desktop, chatOpen, enlarged, stuck, seenUpTo, newestAt, unread, dialog, pathname]);

  return <TaskViewContext.Provider value={value}>{children}</TaskViewContext.Provider>;
}

/**
 * Which views show which panel, in CSS, so the first paint is right before any JavaScript runs:
 * Work shows for Work, for Chat on a phone (the sheet is over it) and for Details on a desktop
 * (the panel is beside it); Chat's panel only on a desktop; Details always on a desktop (the right
 * panel) and for Details on a phone.
 */
const PANEL: Record<TaskView, string> = {
  work: "hidden data-[view=work]:flex max-md:data-[view=chat]:flex md:data-[view=details]:flex",
  chat: "hidden md:data-[view=chat]:flex",
  details: "max-md:hidden max-md:data-[view=details]:flex md:flex",
};

/** One view's panel. `aside` for Details, which is the desktop's right panel. */
export function TaskViewPanel({
  name,
  children,
  className,
}: {
  name: TaskView;
  children: ReactNode;
  className?: string;
}) {
  const { view } = useTaskView();
  const Element = name === "details" ? "aside" : "section";
  return (
    <Element
      id={`task-panel-${name}`}
      aria-label={name === "details" ? "Details" : undefined}
      aria-labelledby={name === "details" ? undefined : `task-tab-${name}`}
      data-slot={`task-panel-${name}`}
      data-view={view}
      className={cn("min-w-0 flex-col gap-6", PANEL[name], className)}
    >
      {children}
    </Element>
  );
}

/** The chosen look of a tab, per view and layout, in CSS (like the panels). */
const ACTIVE: Record<TaskView, string> = {
  work: "data-[view=work]:bg-background data-[view=work]:text-foreground data-[view=work]:shadow-sm max-md:data-[view=chat]:bg-background max-md:data-[view=chat]:text-foreground max-md:data-[view=chat]:shadow-sm md:data-[view=details]:bg-background md:data-[view=details]:text-foreground md:data-[view=details]:shadow-sm",
  chat: "md:data-[view=chat]:bg-background md:data-[view=chat]:text-foreground md:data-[view=chat]:shadow-sm",
  details:
    "data-[view=details]:bg-background data-[view=details]:text-foreground data-[view=details]:shadow-sm",
};

/** What the stuck bar says beside the tabs (the sample's "Edit · overdue 4 days"). */
export type TaskTabsContext = {
  title: string;
  /** The deadline relative to now ("overdue 4 days", "in 2 days"); null once the task is final. */
  relative: string | null;
  overdue: boolean;
};

/**
 * The views' bar (decisions 27, 32): **Work · Chat · Details** on a phone, sticky under
 * the title bar, **Work · Chat** on a desktop (Details is the right panel). Each is a
 * 44px target; the bar scrolls sideways at large text instead of squeezing its labels (§14.2 i),
 * and nothing swipes between views (a sideways swipe is the phone's back gesture). Chat carries
 * the unread count ("Chat · 2 new"); on a phone it opens the sheet.
 *
 * **On a laptop (task chat height, owner 23 Oct; the sample
 * `docs/design/v18-task-chat-height-sample.html`):** the bar sticks under the top bar as the page
 * scrolls (the header scrolls away), in the same place and look, and once stuck it names the task
 * beside the tabs ("Edit · overdue 4 days"); **⤢** at its right end (44 px) enlarges the chat over
 * the dimmed page (an overlay layer, never a view). Nothing switches by itself. A phone's bar is
 * unchanged: no ⤢, no name, its own sticky place under the title bar.
 */
export function TaskTabs({ context }: { context: TaskTabsContext }) {
  const { view, choose, desktop, openChat, unread, setEnlarged, stuck, setBand } = useTaskView();
  const bar = useRef<HTMLDivElement>(null);
  const shown = shownView(view, desktop === true);
  usePublishedHeaderHeight();

  // Keep the chosen view in sight when the bar scrolls (large text).
  useEffect(() => {
    const scroller = bar.current;
    const active = scroller?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!scroller || !active) return;
    const left = active.offsetLeft - scroller.offsetLeft;
    if (
      left < scroller.scrollLeft ||
      left + active.offsetWidth > scroller.scrollLeft + scroller.clientWidth
    ) {
      scroller.scrollLeft = Math.max(0, left - 8);
    }
  }, [shown]);

  const tabs: { name: TaskView; label: string; className?: string }[] = [
    { name: "work", label: "Work" },
    { name: "chat", label: chatLabel(unread) },
    { name: "details", label: "Details", className: "md:hidden" },
  ];

  return (
    <div
      ref={setBand}
      data-slot="task-tabs-band"
      data-stuck={stuck ? "true" : "false"}
      // A laptop's bar sticks under the top bar with the same left edge; once stuck, a hairline
      // under it (transparent until then, so nothing moves when it sticks).
      className="bg-background md:data-[stuck=true]:border-border sticky top-[var(--app-page-header-h,2.75rem)] z-10 -mx-4 border-b px-4 py-2 md:top-(--app-top-bar-h) md:z-20 md:mx-0 md:flex md:min-w-0 md:items-center md:gap-2 md:border-transparent md:px-0 md:py-2"
    >
      <div
        ref={(element) => {
          bar.current = element;
          // `data-live` once hydrated: a tap from then on is the app's (specs wait for it).
          markLive(element);
        }}
        role="group"
        aria-label="Task views"
        data-slot="task-tabs"
        // A designed sideways scroller (decision 32): at large text the views scroll, not squeeze.
        data-scroll-x=""
        className="bg-muted flex gap-1 overflow-x-auto rounded-lg p-1 md:inline-flex md:max-w-full md:shrink-0"
      >
        {tabs.map((tab) => {
          const current = tab.name === shown && !(tab.name === "chat" && desktop !== true);
          return (
            <button
              key={tab.name}
              type="button"
              id={`task-tab-${tab.name}`}
              data-slot="task-tab"
              data-view-tab={tab.name}
              data-view={view}
              aria-current={current ? "true" : undefined}
              aria-controls={
                tab.name === "chat" && desktop === false ? undefined : `task-panel-${tab.name}`
              }
              aria-haspopup={tab.name === "chat" && desktop === false ? "dialog" : undefined}
              className={cn(
                "pressable text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 flex-1 shrink-0 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none select-none focus-visible:ring-2 md:flex-none md:px-4",
                ACTIVE[tab.name],
                tab.className,
              )}
              onClick={() => (tab.name === "chat" ? openChat() : choose(tab.name))}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* Stuck only: the task's name and its deadline, so the header can scroll away. */}
      <p
        data-slot="task-tabs-context"
        aria-hidden={stuck ? undefined : true}
        className={cn(
          "text-muted-foreground hidden min-w-0 truncate text-sm",
          stuck && "md:ml-1.5 md:block",
        )}
      >
        {context.title}
        {context.relative ? (
          <>
            {" · "}
            <span className={cn(context.overdue && "text-destructive")}>{context.relative}</span>
          </>
        ) : null}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-slot="task-chat-enlarge"
        aria-label="Enlarge the chat"
        title="Enlarge the chat"
        aria-haspopup="dialog"
        className="text-muted-foreground hidden size-11 md:ml-auto md:inline-flex"
        onClick={() => setEnlarged(true)}
      >
        <Maximize2Icon aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Whether the laptop's bar is stuck under the top bar (task chat height): read on scroll and
 * resize, once a frame at most. A phone never asks (its bar is unchanged).
 */
function useStuckBar(node: HTMLDivElement | null, active: boolean): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!active || !node) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const stickAt = Number.parseFloat(getComputedStyle(node).top) || 0;
      setStuck(barStuck(node.getBoundingClientRect().top, stickAt, window.scrollY));
    };
    const soon = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    soon();
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon);
      window.removeEventListener("resize", soon);
    };
  }, [node, active]);
  return active && stuck;
}

/**
 * The title bar's height, published for the sticky views' bar to sit right under it (a long
 * title takes two lines, and large text grows it).
 */
function usePublishedHeaderHeight(): void {
  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>('[data-slot="page-header"]');
    if (!header) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--app-page-header-h", `${header.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-page-header-h");
    };
  }, []);
}
