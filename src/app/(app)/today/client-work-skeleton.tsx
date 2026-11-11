import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * The Admin's Client work rows while their chunk is on its way (X5, `client-work-lazy.tsx`): the
 * fallback of their own Suspense boundary, drawn on the server. Each row traces its item: the
 * title (20 px), the project · client · date line (16 px) and, when it has stages, the meter line
 * under them, in the same 44 px column and padding, so the rows replace these in place.
 */
export function ClientWorkRowsSkeleton({ rows }: { rows: readonly { meter: boolean }[] }) {
  return (
    <ul
      aria-hidden
      data-slot="loading-today-client-work-rows"
      className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
    >
      {rows.map((row, index) => (
        <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <span className="flex min-h-11 min-w-0 flex-[1_1_8rem] flex-col justify-center gap-0.5">
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-1/2" />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-3 w-2/3" />
            </span>
            {row.meter ? (
              <span className="mt-0.5 flex h-4 items-center gap-2">
                <Skeleton className="h-1.5 w-20 rounded-full" />
                <Skeleton className="h-3 w-6" />
              </span>
            ) : null}
          </span>
          <Skeleton className="ml-auto h-11 w-24 shrink-0 rounded-lg md:h-8" />
        </li>
      ))}
    </ul>
  );
}
