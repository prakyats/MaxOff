import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * The company form: a few labelled fields.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Company"
      shape="detail"
      count={3}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
