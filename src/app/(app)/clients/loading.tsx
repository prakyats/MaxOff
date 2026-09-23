import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * The client list (3.x) is a card list, same shape as People.
 */
export default function Loading() {
  return <PageLoading title="Clients" shape="cards" />;
}
