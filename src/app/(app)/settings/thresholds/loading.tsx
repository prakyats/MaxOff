import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * The thresholds form: labelled number fields.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Thresholds"
      shape="detail"
      count={5}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
