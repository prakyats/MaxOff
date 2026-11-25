import { PageLoading } from "@/core/ui/composites/loading-state";

/** The entry page draws a detail-shaped placeholder itself; this is the same shape a beat earlier. */
export default function Loading() {
  return <PageLoading title="Opening…" shape="detail" />;
}
