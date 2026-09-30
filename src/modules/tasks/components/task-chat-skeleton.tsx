import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The composer while its code loads (decision 31): the textarea's 44px box and the Send button
 * beside it, where they will be.
 */
export function ChatComposerSkeleton() {
  return (
    <div
      aria-hidden
      data-slot="task-chat-composer-skeleton"
      className="flex min-w-0 items-end gap-2"
    >
      <Skeleton className="h-11 min-w-0 flex-1 rounded-lg" />
      <Skeleton className="h-11 w-20 shrink-0 rounded-lg" />
    </div>
  );
}
