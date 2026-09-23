import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * My profile is one record: an avatar block and labelled fields.
 */
export default function Loading() {
  return <PageLoading title="Me" shape="detail" />;
}
