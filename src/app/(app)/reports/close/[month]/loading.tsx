import { PageHeader } from "@/core/ui/composites/page-header";
import { MonthCloseSkeleton } from "@/modules/revenue";

import { CLOSE_DESCRIPTION } from "./copy";

/**
 * The close screen traced (v3.5 U4): the header with its back to Revenue, then the month's line
 * and a section of two-line rows with the one action's bar (`MonthCloseSkeleton`, in the screen's
 * own boxes). No word and no figure of the month, and nothing that says whether it is closed: a
 * loading screen is drawn before the page has checked who is asking.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/reports/revenue", label: "Revenue" }}
        title="Month close"
        description={CLOSE_DESCRIPTION}
        help={CLOSE_DESCRIPTION}
      />
      <MonthCloseSkeleton />
    </>
  );
}
