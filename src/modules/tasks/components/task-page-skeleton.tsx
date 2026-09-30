"use client";

import { useSearchParams } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { parseTaskView } from "../domain/page";

import { ChatComposerSkeleton } from "./task-chat-skeleton";

/**
 * The task page's loading screen below its first glance (Kickoff 4 decision 31): the views' bar
 * and **the view the address asks for** (`?tab=`), traced, so a task opened on Activity, Details
 * or Chat loads in the shape it lands in: Work (the landing view) by default, Chat's thread on a
 * desktop and Chat's full-height sheet over Work on a phone, Activity's rows, Details' people.
 * The same CSS as the page decides what shows where (`TaskViewPanel`), so nothing waits for
 * JavaScript. Every column is `min-w-0`, so a rem-wide bar never widens a phone at 200% text.
 */
export function TaskViewsSkeleton() {
  const view = parseTaskView(useSearchParams().get("tab"));
  return (
    <>
      <div
        aria-hidden
        data-slot="loading-task-tabs"
        className="bg-background sticky top-[calc(var(--app-chrome-h)+var(--app-page-header-h,2.75rem))] z-10 -mx-4 border-b px-4 py-2 md:static md:mx-0 md:border-0 md:p-0"
      >
        <div className="bg-muted flex gap-1 rounded-lg p-1 md:inline-flex">
          {["w-10", "w-9", "w-14", "w-12"].map((width, index) => (
            <div
              key={width}
              className={cn(
                "flex min-h-11 min-w-0 flex-1 items-center justify-center px-3 md:flex-none md:px-4",
                index === 3 && "md:hidden",
              )}
            >
              <Skeleton className={`h-3.5 ${width}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Work: the stages (the brief and the hand-in share the heading and row shape). */}
      <div
        aria-hidden
        data-slot="loading-task-work"
        data-view={view}
        className="hidden min-w-0 flex-col gap-2 data-[view=work]:flex max-md:data-[view=chat]:flex md:data-[view=details]:flex"
      >
        <div className="flex h-5 min-w-0 items-center justify-between gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="border-border divide-border bg-card divide-y rounded-lg border">
          {["w-40", "w-32"].map((width) => (
            <div key={width} className="flex min-h-12 min-w-0 items-center gap-3 py-2 pl-3">
              <Skeleton className="size-4 shrink-0 rounded-[4px]" />
              <div className="flex h-5 min-w-0 items-center">
                <Skeleton className={`h-4 ${width} max-w-full`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat on a desktop: the thread, then the composer. */}
      <div
        aria-hidden
        data-slot="loading-task-chat"
        data-view={view}
        className="hidden min-w-0 flex-col gap-4 md:data-[view=chat]:flex"
      >
        <ChatThreadSkeleton />
        <ChatComposerSkeleton />
      </div>

      {/* Chat on a phone: the full-height sheet, over Work. */}
      <div
        aria-hidden
        data-slot="loading-task-chat-sheet"
        data-view={view}
        className="bg-popover fixed inset-x-0 bottom-0 z-50 hidden h-[calc(100dvh-var(--app-safe-top)-0.75rem)] flex-col rounded-t-2xl border-t shadow-lg max-md:data-[view=chat]:flex"
      >
        <div className="flex min-h-11 items-center justify-between gap-2 border-b py-1 pr-1 pl-4">
          <div className="flex h-6 items-center">
            <Skeleton className="h-4 w-12" />
          </div>
          <div className="flex size-11 items-center justify-center">
            <Skeleton className="size-4" />
          </div>
        </div>
        <div className="min-h-0 flex-1 px-4 py-3">
          <ChatThreadSkeleton />
        </div>
        <div className="border-t p-3 pb-[calc(0.75rem+var(--app-safe-bottom))]">
          <ChatComposerSkeleton />
        </div>
      </div>

      {/* Activity: the history's rows, a sentence over its time. */}
      <div
        aria-hidden
        data-slot="loading-task-activity"
        data-view={view}
        className="hidden min-w-0 flex-col data-[view=activity]:flex"
      >
        <div className="border-border divide-border bg-card divide-y rounded-lg border">
          {["w-56", "w-44", "w-52"].map((width) => (
            <div key={width} className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
              <div className="flex h-5 min-w-0 items-center">
                <Skeleton className={`h-4 ${width} max-w-full`} />
              </div>
              <div className="flex h-4 min-w-0 items-center">
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Two comments of the thread, as bubbles: a name and time over a line of text. */
function ChatThreadSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {["self-start", "self-end"].map((side) => (
        <div
          key={side}
          className={cn(
            "flex w-3/5 max-w-[85%] min-w-0 flex-col gap-0.5 rounded-xl px-3 py-2",
            side,
            side === "self-end" ? "bg-muted" : "border-border border",
          )}
        >
          <div className="flex h-4 min-w-0 items-center">
            <Skeleton className="h-3 w-24 max-w-full" />
          </div>
          <div className="flex h-5 min-w-0 items-center">
            <Skeleton className="h-4 w-40 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Details while the task loads: the desktop's right panel, and a phone's Details view (Kickoff 4
 * decisions 27, 32): the people (a name over its Task Noted line), then the facts.
 */
export function TaskDetailsSkeleton() {
  const view = parseTaskView(useSearchParams().get("tab"));
  return (
    <div
      aria-hidden
      data-slot="loading-task-details"
      data-view={view}
      className="min-w-0 flex-col gap-6 max-md:hidden max-md:data-[view=details]:flex md:sticky md:top-6 md:flex md:w-64 md:shrink-0 md:self-start lg:w-80"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex h-5 items-center">
          <Skeleton className="h-4 w-14" />
        </div>
        <div className="border-border divide-border bg-card divide-y rounded-lg border">
          {["w-36", "w-28"].map((width) => (
            <div key={width} className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
              <div className="flex h-5 min-w-0 items-center justify-between gap-3">
                <Skeleton className={`h-4 ${width} max-w-full`} />
                <Skeleton className="h-3 w-14 shrink-0" />
              </div>
              <div className="flex h-4 min-w-0 items-center">
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex h-5 items-center">
          <Skeleton className="h-4 w-28" />
        </div>
        {["w-20", "w-44"].map((width) => (
          <div key={width} className="flex min-w-0 flex-col gap-0.5">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-14" />
            </div>
            <div className="flex h-5 min-w-0 items-center">
              <Skeleton className={`h-4 ${width} max-w-full`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
