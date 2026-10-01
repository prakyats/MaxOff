import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { checkThenRead } from "@/core/lib/start-early";
import { markOneRead } from "@/core/notifications/inbox";
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
 * tap is one request. The screen itself shows the target's shape for the moment the router takes;
 * a bad or missing target goes home. The parent is the role's home for a top-level screen
 * (`deep-link.ts`).
 */
export default async function OpenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { to, n } = await searchParams;
  // The mark starts with the session read; the member check is awaited first (§19).
  const [viewer, opened] = await checkThenRead(
    requireMember(),
    isNotificationId(n) ? markOneRead(n) : Promise.resolve(null),
  );
  const home = homeFor(viewer.role);
  const requested = opened ? opened.link : to;
  const target = typeof requested === "string" && isInAppPath(requested) ? requested : home;
  const parent = parentOf(target, home);
  return (
    <>
      <PageHeader title="Opening…" />
      <LoadingState shape="detail" label="Opening" />
      <DeepLinkEntry to={target} parent={parent} />
    </>
  );
}
