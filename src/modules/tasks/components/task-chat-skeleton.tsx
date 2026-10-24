import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The composer while its code loads (decision 31; v1.8 V5b E): the rounded 44px field and the
 * round Send beside it, where they will be.
 */
export function ChatComposerSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="task-chat-composer-skeleton"
      className="flex min-w-0 items-end gap-2"
    >
      <Skeleton className="rounded-composer h-11 min-w-0 flex-1" />
      <Skeleton className="size-11 shrink-0 rounded-full" />
    </div>
  );
}

/**
 * Chat's feed while the task loads (v1.8 V5b E), traced: the first day line, another person's
 * group (photo, name, a bubble, the time) and one of the reader's own, with the feed's paddings,
 * gaps and line boxes (`ChatFeed`).
 */
export function ChatFeedSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 overflow-hidden px-4 py-3">
      <div data-slot="loading-chat-day" className="mt-2.5 mb-2 flex h-4 items-center gap-2.5">
        <div className="bg-border h-px flex-1" />
        <Skeleton className="h-3 w-10" />
        <div className="bg-border h-px flex-1" />
      </div>
      {[false, true].map((own) => (
        <div
          key={String(own)}
          className={cn(
            "mt-2 flex max-w-[75%] min-w-0 items-end gap-2",
            own ? "flex-row-reverse self-end" : "self-start",
          )}
        >
          {own ? null : <Skeleton className="size-7 shrink-0 rounded-full" />}
          <div className={cn("flex min-w-0 flex-col gap-0.5", own && "items-end")}>
            {own ? null : (
              <div className="mb-0.5 ml-2.5 flex h-4 items-center">
                <Skeleton className="h-3 w-16" />
              </div>
            )}
            <div
              className={cn(
                "rounded-bubble border-border border px-3 py-2",
                own ? "rounded-r-control" : "rounded-l-control",
              )}
            >
              <div className="-my-px flex h-5 items-center">
                <Skeleton className={cn("h-3.5 max-w-full", own ? "w-24" : "w-40")} />
              </div>
            </div>
            <div className="mx-2.5 mt-0.5 flex h-4 items-center">
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The laptop panel's head: the photos, the names line and "Everyone on the task sees this chat",
 * then ⤢ at its right end (44 px).
 */
export function ChatHeadSkeleton() {
  return (
    <div className="border-border flex min-w-0 items-center gap-2.5 border-b py-1.5 pr-1.5 pl-4">
      <div className="flex shrink-0 -space-x-1.5">
        <Skeleton className="ring-card size-7 rounded-full ring-2" />
        <Skeleton className="ring-card size-7 rounded-full ring-2" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-28" />
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-48 max-w-full" />
        </div>
      </div>
      <div
        data-slot="loading-task-enlarge"
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <Skeleton className="size-4 rounded-sm" />
      </div>
    </div>
  );
}
