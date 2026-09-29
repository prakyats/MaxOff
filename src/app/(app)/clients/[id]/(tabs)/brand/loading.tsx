import { Card, CardContent } from "@/core/ui/primitives/card";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A client's Brand (3.4) under the painted header and tabs: the logo card (the tile, two lines
 * and the upload button), then the Brand record's heading with Edit, the swatch rows (a chip, a
 * name, the hex), a font with its note, tone of voice and notes.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading the brand"
      data-slot="loading-client-brand"
      className="flex max-w-2xl flex-col gap-4"
    >
      <Card aria-hidden>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="size-16 shrink-0 rounded-xl" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-3.5 w-36" />
            </div>
          </div>
          <Skeleton className="h-9 w-28 shrink-0 rounded-lg" />
        </CardContent>
      </Card>
      <Card aria-hidden>
        <CardContent className="flex flex-col gap-3">
          <div className="flex min-h-11 items-center justify-between">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-9 w-20 rounded-lg" />
          </div>
          {/* Colours: the label and swatch rows (chip, name, hex). */}
          <div className="flex flex-col">
            <Skeleton className="h-3.5 w-16" />
            {[0, 1].map((row) => (
              <div key={row} className="flex min-h-12 items-center gap-3 py-1.5">
                <Skeleton className="size-8 rounded-md" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
          {/* Fonts: the label and a name with its note. */}
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-12" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
          {[0, 1].map((row) => (
            <div key={row} className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-4 w-52" />
            </div>
          ))}
        </CardContent>
      </Card>
      <span className="sr-only">Loading the brand</span>
    </div>
  );
}
