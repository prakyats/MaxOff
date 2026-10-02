import { PageLoading } from "@/core/ui/composites/loading-state";

import { SETTINGS_HEADERS } from "../headers";

/**
 * The thresholds form: labelled time and number fields (ten, with 5B's quiet hours).
 */
export default function Loading() {
  return (
    <PageLoading
      title="Thresholds"
      {...SETTINGS_HEADERS.thresholds}
      shape="detail"
      count={10}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
