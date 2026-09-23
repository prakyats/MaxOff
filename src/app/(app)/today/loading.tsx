import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * Owner Today / Admin dashboard (6.2, 6.3) open on a grid of stat tiles, so the skeleton is
 * tiles — not the list this route used to borrow from People.
 */
export default function Loading() {
  return <PageLoading title="Today" shape="tiles" />;
}
