import { PageHeader } from "@/core/ui/composites/page-header";
import { RevenueSkeleton } from "@/modules/revenue";

import { REVENUE_DESCRIPTION } from "./copy";

/**
 * The Revenue page traced (9.2): the header with its back, then the month row, the category
 * filter, the month's three figures and one client's card (`RevenueSkeleton`, in the page's own
 * boxes). No word and no figure of the month: a loading screen is drawn before the page has
 * checked who is asking.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="Revenue"
        description={REVENUE_DESCRIPTION}
        help={REVENUE_DESCRIPTION}
      />
      <RevenueSkeleton />
    </>
  );
}
