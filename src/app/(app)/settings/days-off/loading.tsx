import { PageLoading } from "@/core/ui/composites/loading-state";

import { SETTINGS_HEADERS } from "../headers";

/**
 * The weekly-off toggles and the holiday list are rows.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Days off & holidays"
      {...SETTINGS_HEADERS.daysOff}
      shape="list"
      count={5}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
