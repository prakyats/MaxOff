import { LoadingState } from "@/core/ui/composites/loading-state";
import { PageHeader } from "@/core/ui/composites/page-header";

import { END_OF_DAY_DESCRIPTION } from "./copy";

/**
 * Reports → End of day (6.5): the header with its back, then the day rows (a heading over a
 * detail line, the same row as the Reports list), traced as a list: today, yesterday and the
 * newest saved day.
 */
export default function Loading() {
  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title="End of day"
        description={END_OF_DAY_DESCRIPTION}
        help={END_OF_DAY_DESCRIPTION}
      />
      <LoadingState shape="list" count={3} label="Loading the reports" className="md:max-w-2xl" />
    </>
  );
}
