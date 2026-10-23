"use client";

import { useSearchParams } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { parseTaskView } from "../domain/page";

import { ChatComposerSkeleton, ChatFeedSkeleton, ChatHeadSkeleton } from "./task-chat-skeleton";

/**
 * The task page's loading screen below its first glance (Kickoff 4 decision 31): the views' bar
 * and **the view the address asks for** (`?tab=`), traced, so a task opened on Details or Chat
 * loads in the shape it lands in: Work (the landing view) by default (an old `?tab=activity` too:
 * its History is a sheet over Work), Chat's panel on a laptop and Chat's full-height view over
 * Work on a phone (v1.8 V5b E), Details' people.
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
        // A laptop's bar (task chat height): its own 8px band and the tabs (⤢ is the chat head's).
        className="bg-background sticky top-[var(--app-page-header-h,2.75rem)] z-10 -mx-4 border-b px-4 py-2 md:top-(--app-top-bar-h) md:mx-0 md:flex md:min-w-0 md:items-center md:gap-2 md:border-transparent md:px-0 md:py-2"
      >
        <div className="bg-muted flex gap-1 rounded-lg p-1 md:inline-flex md:shrink-0">
          {["w-10", "w-9", "w-12"].map((width, index) => (
            <div
              key={width}
              className={cn(
                "flex min-h-11 min-w-0 flex-1 items-center justify-center px-3 md:flex-none md:px-4",
                index === 2 && "md:hidden",
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
        <div className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border">
          {["w-40", "w-32"].map((width) => (
            <div key={width} className="flex min-h-12 min-w-0 items-center gap-3 py-2 pl-3">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <div className="flex h-5 min-w-0 items-center">
                <Skeleton className={`h-4 ${width} max-w-full`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat on a laptop (v1.8 V5b E): the panel, its head, the feed, the pinned composer. */}
      <div
        aria-hidden
        data-slot="loading-task-chat"
        data-view={view}
        className="bg-card border-border shadow-raised rounded-sheet hidden h-[max(20rem,calc(100dvh-22rem))] min-w-0 flex-col overflow-hidden border md:data-[view=chat]:flex"
      >
        <ChatHeadSkeleton />
        <ChatFeedSkeleton />
        <div className="bg-card border-t px-3 pt-2.5 pb-2">
          <ChatComposerSkeleton />
        </div>
      </div>

      {/* Chat on a phone: the full-height view over Work, its back and title, feed, composer. */}
      <div
        aria-hidden
        data-slot="loading-task-chat-sheet"
        data-view={view}
        className="bg-background fixed inset-0 z-50 hidden flex-col border-t pt-[var(--app-safe-top)] shadow-lg max-md:data-[view=chat]:flex"
      >
        <div className="flex items-center gap-1 border-b pr-4 pl-1">
          <div className="flex size-11 shrink-0 items-center justify-center">
            <Skeleton className="size-5" />
          </div>
          <div className="flex min-h-11 min-w-0 flex-1 items-center">
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <ChatFeedSkeleton />
        <div className="border-t px-3 pt-2.5 pb-[calc(0.625rem+var(--app-safe-bottom))]">
          <ChatComposerSkeleton />
        </div>
      </div>
    </>
  );
}

/**
 * Details while the task loads: the desktop's right panel, and a phone's Details view (Kickoff 4
 * decisions 27, 32): one card (PP-task-3) with the people (the photo stack and names, then each
 * photo and name over its Task Noted line; V5b-D), then the facts as label and value pairs.
 */
export function TaskDetailsSkeleton() {
  const view = parseTaskView(useSearchParams().get("tab"));
  return (
    <div
      aria-hidden
      data-slot="loading-task-details"
      data-view={view}
      className="min-w-0 flex-col gap-6 max-md:hidden max-md:data-[view=details]:flex md:sticky md:top-6 md:flex md:w-64 md:shrink-0 md:self-start md:data-[view=chat]:static lg:w-80"
    >
      {/* PP-task-3: People and About the task on one card, the people as divided rows, the
          facts as aligned label and value pairs. */}
      <div className="border-border bg-card shadow-raised flex min-w-0 flex-col gap-5 rounded-lg border p-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex h-5 items-center">
            <Skeleton className="h-4 w-14" />
          </div>
          <div className="divide-border -mx-1 divide-y">
            {/* The people at a glance: the photo stack, the names, the noted line (V5b-D). */}
            <div
              data-slot="loading-task-people-summary"
              className="flex min-w-0 items-center gap-2.5 px-1 py-2.5"
            >
              <div className="flex shrink-0">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="-ml-1.5 size-7 rounded-full" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex h-5 min-w-0 items-center">
                  <Skeleton className="h-4 w-32 max-w-full" />
                </div>
                <div className="flex h-4 min-w-0 items-center">
                  <Skeleton className="h-3 w-40 max-w-full" />
                </div>
              </div>
            </div>
            {["w-36", "w-28"].map((width, index) => (
              <div
                key={width}
                data-slot={index === 0 ? "loading-task-person" : undefined}
                className="flex min-w-0 flex-col gap-0.5 px-1 py-2.5"
              >
                <div className="flex h-5 min-w-0 items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Skeleton className="size-5 shrink-0 rounded-full" />
                    <Skeleton className={`h-4 ${width} max-w-full`} />
                  </span>
                  <Skeleton className="h-3 w-14 shrink-0" />
                </div>
                <div className="flex h-4 min-w-0 items-center pl-7">
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex h-5 items-center">
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2">
            {["w-24", "w-40", "w-32"].map((width) => (
              <div key={width} className="contents">
                <div className="flex h-5 items-center">
                  <Skeleton className="h-3.5 w-16" />
                </div>
                <div className="flex h-5 min-w-0 items-center">
                  <Skeleton className={`h-4 ${width} max-w-full`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
