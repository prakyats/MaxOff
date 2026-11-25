import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { ReadRecorded } from "@/core/notifications/components/read-recorded";
import { markOneRead, markRunRead } from "@/core/notifications/inbox";
import { systemClock } from "@/core/time";
import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { DeepLinkEntry } from "@/core/ui/navigation/deep-link-entry";
import { isInAppPath, isNotificationId, parentOf } from "@/core/ui/navigation/deep-link";
import { homeFor } from "@/core/ui/shell/nav";

export const metadata: Metadata = { title: "Opening" };

/**
 * The deep-link entry (ARCHITECTURE §14.2 h; tasks 5.1 and 5.2): `/open?to=/tasks/<id>` opens the
 * record with its parent list underneath, so back goes to the list. A push tap
 * (`public/sw.js`) comes in with `to`; a row of the bell's history with `n=<notification id>`:
 * that notification is marked read (the member's own row, RLS) and its own link is opened, so the
 * tap is one request. Nothing is revalidated: the bell drops on the device (`ReadRecorded`, owner
 * decision 2026-10-01). The screen itself shows the target's shape for the moment the router takes;
 * a bad or missing target goes home. The parent is the role's home for a top-level screen
 * (`deep-link.ts`).
 */
export default async function OpenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { to, n, run } = await searchParams;
  // perf: sequential (a write, not a read: only an active member's tap marks a row read)
  const viewer = await requireMember();
  // A row holding a run about one record (`run=1`, 5B decision 10) reads every unread one about it.
  const opened = !isNotificationId(n)
    ? null
    : run === "1"
      ? await markRunRead(n)
      : await markOneRead(n).then((one) => one && { link: one.link, marked: one.marked ? 1 : 0 });
  const writtenAt = systemClock().getTime();
  const home = homeFor(viewer.role);
  const requested = opened ? opened.link : to;
  const target = typeof requested === "string" && isInAppPath(requested) ? requested : home;
  const parent = parentOf(target, home);
  return (
    <>
      <PageHeader title="Opening…" />
      <LoadingState shape="detail" label="Opening" />
      {opened?.marked && isNotificationId(n) ? (
        <ReadRecorded id={n} marked={opened.marked} writtenAt={writtenAt} />
      ) : null}
      <DeepLinkEntry to={target} parent={parent} />
    </>
  );
}
