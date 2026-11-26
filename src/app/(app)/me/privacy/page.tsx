import type { Metadata } from "next";

import { requireMember } from "@/core/auth/server";
import { formatIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getOwnNoticeRead, needsReading, PrivacyNotice } from "@/modules/privacy";
import { PrivacyGotIt } from "@/modules/privacy/components/privacy-got-it";

import { PRIVACY_HEADER } from "./header";

export const metadata: Metadata = { title: "Privacy" };

/**
 * Me → Privacy (v7.5 Q1, owner 2026-11-26; docs/PRIVACY.md): the staff privacy notice, the same for
 * every role, then "Got it" (or when it was read). Reached from Me and from the home screen's
 * one-time card.
 */
export default async function PrivacyPage() {
  const [, read] = await Promise.all([requireMember(), getOwnNoticeRead()]);
  const readOn =
    read && !needsReading(read.version) ? formatIST(new Date(read.readAt), "d MMM yyyy") : null;
  return (
    <>
      <PageHeader
        title={PRIVACY_HEADER.title}
        description={PRIVACY_HEADER.description}
        back={PRIVACY_HEADER.back}
      />
      <div className="flex flex-col gap-8">
        <PrivacyNotice />
        <PrivacyGotIt readOn={readOn} />
      </div>
    </>
  );
}
