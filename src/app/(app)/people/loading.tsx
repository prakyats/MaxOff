import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * People renders `DataTable` with a `mobile` card spec, so the load traces those cards.
 */
export default function Loading() {
  return <PageLoading title="People" shape="cards" />;
}
