import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageLoading } from "@/core/ui/composites/loading-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { ME_DESCRIPTION } from "./copy";

/**
 * Traces `page.tsx` card for card (ARCHITECTURE §14.1): the profile card with the avatar block,
 * the sign-in line, the read-only Profile record (its heading row with Edit, two label and value
 * rows, task 2.9) under the photo button row (3.3), then for whoever marks attendance the rows of
 * their own pages (5B decision 3: Extra work & expenses; Attendance & leave above it for an
 * Admin), then Appearance, Notifications and Sign out, then "Your devices" (5.5: drawn with one
 * device, the usual case: its name, platform and last-notification lines and the trailing "This
 * device" or Remove), then "Help & troubleshooting" (5B decision 4: the test push, Reload app, the
 * version). Same member check as `my-day/loading.tsx`.
 *
 * Every column beside something else is `min-w-0`, as the page's is (3c review, CI red on /me at
 * 200%): a bar's `w-40` is 320px at 200% system text, and a flex or grid column with no minimum
 * takes its widest bar as its own minimum, so `max-w-full` on the bar had nothing to clamp to
 * and the column reached past a 430px phone. The device rows wrap like the page's
 * (`flex-[1_1_10rem]`).
 */
/**
 * The device card's rows as `page.tsx` draws them at 375 px: the description's lines (Sign out's
 * and Reload app's wrap to two) and the control, at the shell's 44px minimum for buttons on a
 * phone (`globals.css`) and its own 32px from `md` up.
 */
/** One text line of the page (`text-sm`, 20px): a bar in a line box of the same height. */
function Line({ width, className }: { width: string; className?: string }) {
  return (
    <span className={`flex h-5 min-w-0 items-center ${className ?? ""}`}>
      <Skeleton className={`h-3.5 max-w-full ${width}`} />
    </span>
  );
}

/**
 * A row's text lines: `lines` are drawn everywhere, `phoneLines` only below `md`, where the
 * description wraps further beside its button.
 */
type Row = {
  name: string;
  lines: readonly string[];
  phoneLines?: readonly string[];
  control: string;
};

const DEVICE_ROWS: readonly Row[] = [
  { name: "appearance", lines: ["w-52"], control: "size-11 md:size-8" },
  // 5.2: the Notifications row ("Checking this device…", no control until it is known).
  { name: "notifications", lines: ["w-40"], control: "" },
  { name: "sign-out", lines: ["w-56", "w-40"], phoneLines: ["w-24"], control: "h-11 w-24 md:h-8" },
];

/** Help & troubleshooting's two rows (5B decision 4); the version line follows them. */
const HELP_ROWS: readonly Row[] = [
  { name: "push-test", lines: ["w-56"], phoneLines: ["w-44", "w-24"], control: "h-11 w-28 md:h-8" },
  { name: "reload", lines: ["w-56", "w-28"], phoneLines: ["w-20"], control: "h-11 w-28 md:h-8" },
];

function Rows({ rows }: { rows: readonly Row[] }) {
  return rows.map((row, index) => (
    <div key={row.name} className="flex flex-col gap-4">
      {index > 0 ? <Separator /> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-[1_1_10rem] flex-col">
          <Line width="w-24" />
          {row.lines.map((width, line) => (
            <Line key={line} width={width} />
          ))}
          {(row.phoneLines ?? []).map((width, line) => (
            <Line key={`phone-${line}`} width={width} className="md:hidden" />
          ))}
        </div>
        {row.control ? <Skeleton className={`shrink-0 rounded-lg ${row.control}`} /> : null}
      </div>
    </div>
  ));
}

/** A row of Me that opens one of the member's own pages. */
function PageRow({ slot }: { slot: string }) {
  return (
    <div
      data-slot={slot}
      className="flex min-h-14 items-center justify-between gap-4 rounded-xl px-4 py-3"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <Line width="w-36" />
        <Line width="w-64" />
      </div>
      <Skeleton className="size-4 shrink-0 rounded-sm" />
    </div>
  );
}

export default async function Loading() {
  const member = await getCurrentMember();
  const ownPages = member !== null && can(member.role, "attendance.self");
  const leaveRow = ownPages && member.role !== "staff";
  return (
    <PageLoading title="Me" description={ME_DESCRIPTION} shape="detail">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Me"
        data-slot="loading-state"
        className="flex max-w-xl flex-col gap-4"
      >
        <Card aria-hidden>
          <CardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-col">
                <CardTitle>
                  <span className="flex h-[1lh] items-center">
                    <Skeleton className="h-4 w-40 max-w-full" />
                  </span>
                </CardTitle>
                <CardDescription>
                  <Line width="w-24" />
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* "Signs in as …": two lines on a phone, one from `md` up. */}
            <div className="flex flex-col">
              <Line width="w-64" />
              <span className="md:hidden">
                <Line width="w-28" />
              </span>
            </div>
            <Skeleton className="h-11 w-36 rounded-lg md:h-8" />
            <Separator />
            <div data-slot="loading-record">
              <div className="flex min-h-11 items-center justify-between gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-28 rounded-lg" />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {[0, 1].map((row) => (
                  <div key={row} className="flex flex-col">
                    <Line width="w-20" />
                    <Line width="w-44" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        {ownPages ? (
          <Card aria-hidden className="gap-0 py-0" data-slot="loading-me-pages">
            {leaveRow ? (
              <>
                <PageRow slot="loading-me-leave-link" />
                <Separator />
              </>
            ) : null}
            <PageRow slot="loading-me-work-link" />
          </Card>
        ) : null}
        <Card aria-hidden>
          <CardContent className="flex flex-col gap-4">
            <Rows rows={DEVICE_ROWS} />
          </CardContent>
        </Card>
        <Card aria-hidden data-slot="loading-me-devices">
          {/* The header's grid cells take their widest bar as a minimum without `min-w-0`. */}
          <CardHeader>
            <CardTitle className="min-w-0">
              <span className="flex h-[1lh] min-w-0 items-center">
                <Skeleton className="h-4 w-28 max-w-full" />
              </span>
            </CardTitle>
            <CardDescription className="min-w-0">
              <Line width="w-44" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-[1_1_10rem] flex-col">
                <Line width="w-36" />
                <Line width="w-40" />
                <Line width="w-48" />
              </div>
              <Line width="w-20" />
            </div>
          </CardContent>
        </Card>
        <Card aria-hidden data-slot="loading-me-help">
          <CardHeader>
            <Line width="w-36" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Rows rows={HELP_ROWS} />
            <Separator />
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-32" />
            </span>
          </CardContent>
        </Card>
        <span className="sr-only">Loading Me</span>
      </div>
    </PageLoading>
  );
}
