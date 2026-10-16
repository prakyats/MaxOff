import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { ROLE_LABELS } from "@/core/lib/role-labels";
import { PageHeader } from "@/core/ui/composites/page-header";
import { guideFor, guideShotsFor } from "@/modules/guide";
import { GuideView } from "@/modules/guide/components/guide-view";

import { GUIDE_HEADER } from "./header";

export const metadata: Metadata = { title: "How MaxOff works" };

/**
 * "How MaxOff works" (ROADMAP 6b.14): the in-app guide, for the reader's role only. The role's
 * topics are chosen here, on the server, so no other role's guide reaches the browser, and so are
 * the screenshots: only those the role's own steps show (`guideShotsFor`). Reached
 * from Me (everyone) and Settings → Help and troubleshooting (the Owner and Admins).
 */
export default async function GuidePage() {
  const viewer = await requireMember();
  const guide = guideFor(viewer.role);

  return (
    <>
      <PageHeader
        title={GUIDE_HEADER.title}
        description={GUIDE_HEADER.description}
        help={GUIDE_HEADER.description}
        back={GUIDE_HEADER.back}
      />
      <p className="text-muted-foreground -mt-2 mb-4 text-sm" data-slot="guide-role">
        Written for: <span className="text-foreground font-medium">{ROLE_LABELS[viewer.role]}</span>
      </p>
      <GuideView guide={guide} shots={guideShotsFor(guide)} />
    </>
  );
}
