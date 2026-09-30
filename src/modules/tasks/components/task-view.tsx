"use client";

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
import { closeOverlaysThen } from "@/core/ui/overlay/overlay-history";
import { useIsDesktop } from "@/core/ui/viewport/use-desktop";

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
  /** Chat, whichever way this screen has it: the view on a desktop, the sheet on a phone. */
  openChat: () => void;
  /** Whether the viewer has Chat in front of them now (the view, or the open sheet). */
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
 * The task page's view state (Kickoff 4 decisions 27, 28, 32). The views (Work, Chat, Activity,
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
      // (§14.1, as the list filters do), then the address is replaced.
      closeOverlaysThen(() => {
        window.history.replaceState(
          null,
          "",
          `${pathname}${viewQuery(window.location.search, next)}`,
        );
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
      openChat: () => {
        if (window.matchMedia("(min-width: 768px)").matches) choose("chat");
        else setChatOpen(true);
      },
      chatVisible: desktop === true ? view === "chat" : desktop === false && chatOpen,
      unread: seen ? 0 : unread,
      markSeen: setSeenUpTo,
      dialog,
      setDialog,
    };
  }, [view, desktop, chatOpen, seenUpTo, newestAt, unread, dialog, pathname]);

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
  activity: "hidden data-[view=activity]:flex",
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
  activity:
    "data-[view=activity]:bg-background data-[view=activity]:text-foreground data-[view=activity]:shadow-sm",
  details:
    "data-[view=details]:bg-background data-[view=details]:text-foreground data-[view=details]:shadow-sm",
};

/**
 * The views' bar (decisions 27, 32): **Work · Chat · Activity · Details** on a phone, sticky under
 * the title bar, **Work · Chat · Activity** on a desktop (Details is the right panel). Each is a
 * 44px target; the bar scrolls sideways at large text instead of squeezing its labels (§14.2 i),
 * and nothing swipes between views (a sideways swipe is the phone's back gesture). Chat carries
 * the unread count ("Chat · 2 new"); on a phone it opens the sheet.
 */
export function TaskTabs() {
  const { view, choose, desktop, openChat, unread } = useTaskView();
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
    { name: "activity", label: "Activity" },
    { name: "details", label: "Details", className: "md:hidden" },
  ];

  return (
    <div
      data-slot="task-tabs-band"
      className="bg-background sticky top-[calc(var(--app-chrome-h)+var(--app-page-header-h,2.75rem))] z-10 -mx-4 border-b px-4 py-2 md:static md:mx-0 md:border-0 md:p-0"
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
        className="bg-muted flex gap-1 overflow-x-auto rounded-lg p-1 md:inline-flex md:max-w-full"
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
    </div>
  );
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
