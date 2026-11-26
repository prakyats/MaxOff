import { PageHeader } from "@/core/ui/composites/page-header";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { PrivacyNotice } from "@/modules/privacy";

import { PRIVACY_HEADER } from "./header";

/**
 * Traces Me → Privacy: the header, then the notice's own words drawn unseen (each line a bar that
 * wraps where the page's will), then the 44px "Got it" row. No member data.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        title={PRIVACY_HEADER.title}
        description={PRIVACY_HEADER.description}
        back={PRIVACY_HEADER.back}
      />
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading the privacy notice"
        className="flex flex-col gap-8"
        data-slot="privacy-loading"
      >
        <PrivacyNotice unseen />
        <Skeleton className="h-11 w-24 rounded-md" />
      </div>
    </>
  );
}
