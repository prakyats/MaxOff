import { PageLoading } from "@/core/ui/composites/loading-state";

import { SETTINGS_HEADERS } from "../headers";

/**
 * The job-title list manager is rows.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Job titles"
      {...SETTINGS_HEADERS.jobTitles}
      shape="list"
      count={5}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
