import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The strip's tracing for `loading.tsx` (and the tap drawings, v7.0: its own file, free of the strip's reads) (ARCHITECTURE §14.1): one 44px row inside the border, as
 * the strip's own 44px link sits inside its border, with the dot, the text and the button.
 */
export function TodayAttendanceStripSkeleton() {
  return (
    <div
      data-slot="attendance-strip-skeleton"
      aria-hidden
      className="border-border bg-card mb-4 rounded-lg border px-3"
    >
      <div className="flex min-h-11 items-center gap-2">
        <Skeleton className="size-2 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="ml-auto h-8 w-20 shrink-0 rounded-md" />
      </div>
    </div>
  );
}
