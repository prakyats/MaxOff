import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * The notification inbox (5.1) is a plain list of rows.
 */
export default function Loading() {
  return <PageLoading title="Alerts" shape="list" />;
}
