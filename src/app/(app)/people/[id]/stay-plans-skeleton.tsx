import { Card, CardContent } from "@/core/ui/primitives/card";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * "Stay until, coming up" while a person's Profile loads (v7.0, `StayPlansCard`): the card's
 * heading and its one line (nothing set ahead, the usual case), then the full-width
 * **Stay until…** button (44 px on a phone, the button's own height from md).
 */
export function StayPlansSkeleton() {
  return (
    <div aria-hidden data-slot="stay-plans-skeleton" className="flex flex-col gap-3">
      <Card>
        <CardContent className="flex flex-col gap-3 text-sm">
          <span className="flex h-5 items-center">
            <Skeleton className="h-4 w-36" />
          </span>
          <span className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-56 max-w-full" />
          </span>
        </CardContent>
      </Card>
      <Skeleton className="h-11 w-full rounded-lg md:h-8 md:w-28" />
    </div>
  );
}
