import { PageLoading } from "@/core/ui/composites/loading-state";

import { SETTINGS_HEADERS } from "../headers";

/**
 * The thresholds form: labelled time and number fields (ten, with 5B's quiet hours), 7B's two
 * client-work escalations, 6.5's Weekly summary day, then 5.3's Default reminders line: fourteen.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Thresholds"
      {...SETTINGS_HEADERS.thresholds}
      shape="detail"
      count={14}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
