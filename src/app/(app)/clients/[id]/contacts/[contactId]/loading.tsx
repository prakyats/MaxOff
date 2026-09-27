import { PageLoading } from "@/core/ui/composites/loading-state";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * A contact (3.4): the title bar, then the Contact record's heading with Edit and its four rows
 * (name, designation, email, phone), each a label over a value.
 */
export default function Loading() {
  return (
    <PageLoading title="Contact" shape="detail">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading the contact"
        data-slot="loading-contact"
        className="flex max-w-xl flex-col gap-4"
      >
        <Card aria-hidden>
          <CardContent className="flex flex-col gap-3">
            <div className="flex min-h-11 items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-9 w-20 rounded-lg" />
            </div>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-4 w-44" />
              </div>
            ))}
          </CardContent>
        </Card>
        <span className="sr-only">Loading the contact</span>
      </div>
    </PageLoading>
  );
}
