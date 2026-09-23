import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * The job-title list manager is rows.
 */
export default function Loading() {
  return (
    <PageLoading
      title="Job titles"
      shape="list"
      count={5}
      back={{ href: "/settings", label: "Settings" }}
    />
  );
}
