import type { ReactNode } from "react";

import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageLoading } from "@/core/ui/composites/loading-state";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Separator } from "@/core/ui/primitives/separator";
import { Skeleton } from "@/core/ui/primitives/skeleton";

import { ME_DESCRIPTION } from "./copy";

/**
 * Traces `page.tsx` section for section (ARCHITECTURE §14.1), in the V5b Me restructure's order:
 * the identity card (the 48 px photo, the name, role and email lines, Edit profile beside them
 * from `md` and under them on a phone, the Phone record and the photo button); for whoever marks
 * attendance "My work" with its two rows; "Notifications" (this device's row, "Your devices" with
 * one device, the usual case, and the test push); "Appearance"; "Help" (the guide and Reload app);
 * the red outline "Sign out of this device" with its line; the version. "Your freelancers" is not
 * drawn: few coordinate one, and the screen cannot know who does before the page reads it.
 * Same member check as `my-day/loading.tsx`.
 *
 * Every column beside something else is `min-w-0`, as the page's is (3c review, CI red on /me at
 * 200%): a flex or grid column with no minimum takes its widest bar as its own minimum.
 */
/** One text line of the page (`text-sm`, 20px): a bar in a line box of the same height. */
function Line({ width, className }: { width: string; className?: string }) {
  return (
    <span className={`flex h-5 min-w-0 items-center ${className ?? ""}`}>
      <Skeleton className={`h-3.5 max-w-full ${width}`} />
    </span>
  );
}

/** A section's heading (14 px semibold) over its card. */
function Section({ slot, title, children }: { slot: string; title: string; children: ReactNode }) {
  return (
    <div data-slot={slot} className="flex flex-col gap-2">
      <Line width={title} />
      {children}
    </div>
  );
}

/** A row with a title, its lines and a trailing button (the device card's and Help's rows). */
function ControlRow({
  lines,
  phoneLines = [],
  control,
}: {
  lines: readonly string[];
  phoneLines?: readonly string[];
  control: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-[1_1_10rem] flex-col">
        <Line width="w-24" />
        {lines.map((width, line) => (
          <Line key={line} width={width} />
        ))}
        {phoneLines.map((width, line) => (
          <Line key={`phone-${line}`} width={width} className="md:hidden" />
        ))}
      </div>
      {control ? <Skeleton className={`shrink-0 rounded-lg ${control}`} /> : null}
    </div>
  );
}

/** A row of Me that opens one of the member's own pages (or the guide). */
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
  return (
    <PageLoading title="Me" description={ME_DESCRIPTION} shape="detail">
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading Me"
        data-slot="loading-state"
        className="flex flex-col gap-6"
      >
        <Card aria-hidden data-slot="loading-me-identity">
          <CardContent className="flex flex-col gap-3">
            <div data-slot="loading-record">
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-[1_1_12rem] items-start gap-3">
                  <Skeleton className="size-12 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex h-6 min-w-0 items-center">
                      <Skeleton className="h-4 w-40 max-w-full" />
                    </span>
                    <Line width="w-20" />
                    <Line width="w-56" />
                    {member?.role === "owner" ? null : (
                      <span className="flex h-4 min-w-0 items-center">
                        <Skeleton className="h-3 w-52 max-w-full" />
                      </span>
                    )}
                  </div>
                </div>
                <Skeleton className="h-11 w-32 rounded-lg md:h-8" />
              </div>
              <div className="mt-3 flex flex-col">
                <Line width="w-12" />
                <Line width="w-28" />
              </div>
            </div>
            <Skeleton className="h-11 w-32 rounded-lg md:h-8" />
          </CardContent>
        </Card>
        {ownPages ? (
          <Section slot="loading-me-work" title="w-16">
            <Card aria-hidden className="gap-0 py-0" data-slot="loading-me-pages">
              <PageRow slot="loading-me-leave-link" />
              <Separator />
              <PageRow slot="loading-me-work-link" />
            </Card>
          </Section>
        ) : null}
        <Section slot="loading-me-notifications" title="w-24">
          <Card aria-hidden data-slot="loading-me-devices">
            <CardContent className="flex flex-col gap-4">
              {/* 5.2: "Checking this device…", no control until it is known. */}
              <ControlRow lines={["w-40"]} control={null} />
              <Separator />
              <div className="flex flex-col">
                <Line width="w-24" />
                <Line width="w-44" className="mb-3" />
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-[1_1_10rem] flex-col">
                    <Line width="w-36" />
                    <Line width="w-40" />
                    <Line width="w-48" />
                  </div>
                  <Line width="w-20" />
                </div>
              </div>
              <Separator />
              <ControlRow lines={["w-56"]} phoneLines={["w-24"]} control="h-11 w-24 md:h-8" />
            </CardContent>
          </Card>
        </Section>
        <Section slot="loading-me-appearance" title="w-24">
          <Card aria-hidden>
            <CardContent>
              <ControlRow lines={["w-52"]} control="size-11 md:size-8" />
            </CardContent>
          </Card>
        </Section>
        <Section slot="loading-me-help" title="w-10">
          <Card aria-hidden className="gap-0 py-0">
            <PageRow slot="loading-me-guide-link" />
            <Separator />
            <div className="px-4 py-3">
              <ControlRow
                lines={["w-56", "w-28"]}
                phoneLines={["w-20"]}
                control="h-11 w-28 md:h-8"
              />
            </div>
          </Card>
        </Section>
        <div aria-hidden className="flex flex-col gap-2">
          <Skeleton className="h-11 w-full rounded-lg md:h-8 md:w-48" />
          <Line width="w-72" />
          <Line width="w-40" className="md:hidden" />
        </div>
        <span aria-hidden className="flex h-4 items-center">
          <Skeleton className="h-3 w-24" />
        </span>
        <span className="sr-only">Loading Me</span>
      </div>
    </PageLoading>
  );
}
