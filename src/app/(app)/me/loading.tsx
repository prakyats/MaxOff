import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageLoading } from "@/core/ui/composites/loading-state";
import { Card, CardContent, CardHeader } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * Traces `page.tsx` card for card (ARCHITECTURE §14.1): the profile card with the avatar block,
 * the sign-in line, the read-only Profile record (its heading row with Edit, two label and value
 * rows, task 2.9) under the photo button row (3.3), then the "Attendance & leave" row for
 * whoever marks attendance (2.3), then
 * Appearance, Session and Reload app. Same member check as `my-day/loading.tsx`.
 */
/**
 * The device card's rows as `page.tsx` draws them at 375 px: the description's lines (Sign out's
 * and Reload app's wrap to two) and the control, at the shell's 44px minimum for buttons on a
 * phone (`globals.css`) and its own 32px from `md` up.
 */
const DEVICE_ROWS = [
  { name: "appearance", lines: ["w-52"], control: "size-11 md:size-8" },
  { name: "sign-out", lines: ["w-56", "w-40"], control: "h-11 w-24 md:h-8" },
  { name: "reload", lines: ["w-56", "w-28"], control: "h-11 w-28 md:h-8" },
] as const;

export default async function Loading() {
  const member = await getCurrentMember();
  const leaveRow = member !== null && can(member.role, "attendance.self");
  return (
    <PageLoading title="Me" shape="detail">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Me"
        data-slot="loading-state"
        className="flex max-w-xl flex-col gap-4"
      >
        <Card aria-hidden>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Skeleton className="h-4 w-64 max-w-full" />
            <Skeleton className="h-11 w-36 rounded-lg" />
            <Separator />
            <div data-slot="loading-record">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-28 rounded-lg" />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {[0, 1].map((row) => (
                  <div key={row} className="flex flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-4 w-44" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        {leaveRow ? (
          <div
            data-slot="loading-me-leave-link"
            aria-hidden
            className="bg-card ring-foreground/10 flex min-h-14 items-center justify-between gap-4 rounded-xl px-4 py-3 ring-1"
          >
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3.5 w-64 max-w-full" />
            </div>
            <Skeleton className="size-4 shrink-0 rounded-sm" />
          </div>
        ) : null}
        <Card aria-hidden>
          <CardContent className="flex flex-col gap-4">
            {DEVICE_ROWS.map((row, index) => (
              <div key={row.name} className="flex flex-col gap-4">
                {index > 0 ? <Separator /> : null}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-[1_1_10rem] flex-col gap-1.5">
                    <Skeleton className="h-4 w-24" />
                    {row.lines.map((width, line) => (
                      <Skeleton key={line} className={`h-3.5 max-w-full ${width}`} />
                    ))}
                  </div>
                  <Skeleton className={`rounded-lg ${row.control}`} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <span className="sr-only">Loading Me</span>
      </div>
    </PageLoading>
  );
}
