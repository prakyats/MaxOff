import { cn } from "@/core/lib/utils";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/** Skeleton rows for a list or table while its data loads. */
export function LoadingState({
  rows = 4,
  className,
  label = "Loading",
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-slot="loading-state"
      className={cn("flex flex-col gap-3", className)}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/2 max-w-64" />
            <Skeleton className="h-3 w-1/3 max-w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton for a whole page: a header line and a block, for `loading.tsx` files. */
export function PageLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn("flex flex-col gap-6", className)}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <LoadingState rows={5} />
    </div>
  );
}
