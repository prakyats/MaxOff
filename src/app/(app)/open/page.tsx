import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { DeepLinkEntry } from "@/core/ui/navigation/deep-link-entry";
import { isInAppPath, parentOf } from "@/core/ui/navigation/deep-link";
import { homeFor } from "@/core/ui/shell/nav";

export const metadata: Metadata = { title: "Opening" };

/**
 * The deep-link entry (ARCHITECTURE §14.2 h; task 5.2): `/open?to=/tasks/<id>` opens the
 * record with its parent list underneath, so back goes to the list. A push tap
 * (`public/sw.js`), and from 5A step 4 the bell and the history screen, come in here. The
 * screen itself shows the target's shape for the moment the router takes; a bad or missing
 * `to` goes home. The parent is the role's home for a top-level screen (`deep-link.ts`).
 */
export default async function OpenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, { to }] = await Promise.all([requireMember(), searchParams]);
  const home = homeFor(viewer.role);
  const target = typeof to === "string" && isInAppPath(to) ? to : home;
  const parent = parentOf(target, home);
  return (
    <>
      <PageHeader title="Opening…" />
      <LoadingState shape="detail" label="Opening" />
      <DeepLinkEntry to={target} parent={parent} />
    </>
  );
}
