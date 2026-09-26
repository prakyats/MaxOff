import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * The weekly-off toggles and the holiday list are rows.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Days off & holidays"
      shape="list"
      count={5}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
