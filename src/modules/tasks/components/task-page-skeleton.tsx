"use client";

import { useSearchParams } from "next/navigation";

import { cn } from "@/core/lib/utils";
import { DetailHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { TASK_BACK } from "../domain/back";
import { parseTaskView, type TaskView } from "../domain/views";

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
export function TaskViewsSkeleton({ view: asked }: { view?: TaskView | undefined } = {}) {
  const fromAddress = parseTaskView(useSearchParams().get("tab"));
  const view = asked ?? fromAddress;
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
export function TaskDetailsSkeleton({ view: asked }: { view?: TaskView | undefined } = {}) {
  const fromAddress = parseTaskView(useSearchParams().get("tab"));
  const view = asked ?? fromAddress;
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

/**
 * A task's page traced (4.4, reworked to Kickoff 4 decisions 26–32; decision 31): the title bar
 * (with the ⋯ an Owner or Admin usually has, the state chip, and for Staff the next step in the
 * header's action area from `md` up), the first glance (the state chip and priority, the deadline
 * line, the "needed from you" callout), for Staff the next step's sticky bar at a phone's foot (a
 * Staff member nearly always has one), the views' bar and **the view the
 * address asks for** (`TaskViewsSkeleton`), and Details (the desktop's right panel, a phone's view).
 * The same two columns as the page from `md` up; on a phone the parts sit straight in the page.
 * Every column is `min-w-0`, so a rem-wide bar never widens a phone at 200% text (3c review).
 *
 * Drawn by the route's `loading.tsx` and, on a tap the router could not answer from its
 * prefetches, by `TaskTapSkeleton` (#143): one component, so the two never differ. `view` is the
 * view the tapped address asks for; the route's own loading screen reads it from its address.
 */
export function TaskPageSkeleton({ manages, view }: { manages: boolean; view?: TaskView }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the task"
      data-slot="loading-task"
      className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:gap-8"
    >
      <div className="max-md:contents md:flex md:min-w-0 md:flex-1 md:flex-col md:gap-4">
        <DetailHeader
          back={TASK_BACK}
          // The state chip beside the title, and for Staff the next step in the header's action
          // area (PP-task-1, PP-crew-8; laptop only, as on the page).
          status={<Skeleton aria-hidden className="h-5 w-20 rounded-full" />}
          primary={manages ? undefined : <Skeleton aria-hidden className="h-9 w-32 rounded-lg" />}
          title={
            // The title's own line box: 24px on a phone, 32px from `md` up (`PageHeader`'s h1).
            <span className="flex h-6 items-center md:h-8">
              <Skeleton className="h-5 w-48 max-w-full" />
            </span>
          }
          // History (every viewer), then the ⋯ an Owner or Admin usually has.
          menu={
            <>
              <Skeleton aria-hidden className="size-11 rounded-lg" />
              {manages ? <Skeleton aria-hidden className="size-11 rounded-lg md:size-8" /> : null}
            </>
          }
          className="mb-0 flex-wrap md:mb-0"
        />
        {/* The first glance (PP-task-1, PP-task-2): the state chip (a phone's; the header's on
            a laptop) and the quiet priority, the deadline's own line, the callout of what is
            needed now. */}
        <div aria-hidden data-slot="loading-task-glance" className="flex min-w-0 flex-col gap-2">
          {/* A phone's full title under the one-line bar (its 28px line). */}
          <div className="flex h-7 min-w-0 items-center md:hidden">
            <Skeleton className="h-5 w-56 max-w-full" />
          </div>
          {/* The priority and the deadline: two lines on a phone; one 16px line on a laptop
              (task chat height, owner 23 Oct), both 12px there. */}
          <div className="max-md:contents md:flex md:h-4 md:min-w-0 md:items-center md:gap-x-3.5">
            {/* 20px with the phone's chip; 16px on a laptop, where only the 12px priority shows. */}
            <div className="flex h-5 min-w-0 flex-wrap items-center gap-2 md:h-4">
              <Skeleton className="h-5 w-20 rounded-full md:hidden" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex h-5 min-w-0 items-center gap-1.5 md:h-4 md:gap-1">
              <Skeleton className="size-4 shrink-0 rounded-sm md:size-3.5" />
              <Skeleton className="h-4 w-44 max-w-full md:h-3" />
            </div>
          </div>
          {/* The callout; on a laptop 46px with Remind at its right end for whoever usually has it
              (the Owner and Admins; a phone shows Remind under the callout, untraced as before). */}
          <div
            className={cn(
              "border-border bg-muted/50 flex min-w-0 items-center rounded-lg border px-3 py-2.5 md:min-h-[2.875rem] md:gap-2.5 md:py-0",
              manages && "md:pr-1",
            )}
          >
            <div className="flex h-5 min-w-0 items-center md:flex-1">
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            {manages ? (
              <Skeleton
                data-slot="loading-task-remind"
                className="hidden h-11 w-36 shrink-0 rounded-lg md:block"
              />
            ) : null}
          </div>
        </div>
        {manages ? null : (
          <div
            aria-hidden
            data-slot="loading-task-step"
            className="border-border bg-card/95 fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+var(--app-safe-bottom)+var(--app-bands-h,0px))] z-30 flex border-t py-3 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:hidden"
          >
            <Skeleton className="h-11 flex-1 rounded-lg" />
          </div>
        )}
        <TaskViewsSkeleton view={view} />
      </div>
      <TaskDetailsSkeleton view={view} />
      <span className="sr-only">Loading the task</span>
    </div>
  );
}
