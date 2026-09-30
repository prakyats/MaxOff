import { PageLoading } from "@/core/ui/composites/loading-state";

import { SETTINGS_HEADERS } from "../headers";

/**
 * The thresholds form: labelled number fields.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Thresholds"
      {...SETTINGS_HEADERS.thresholds}
      shape="detail"
      count={6}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
