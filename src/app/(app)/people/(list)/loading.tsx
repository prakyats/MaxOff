import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * People renders `DataTable` with a `mobile` card spec, so the load traces those cards.
 *
 * In the `(list)` route group on purpose (2.9): a `loading.tsx` wraps its page **and every child
 * segment**, so at `people/` it was also the boundary for `/people/[id]`, and a tap that beat the
 * prefetch (a board row on a freshly loaded Today) flashed the People list's skeleton before the
 * person. `/people/[id]` has its own layout and skeleton.
 */
export default function Loading() {
  return <PageLoading title="People" shape="cards" />;
}
