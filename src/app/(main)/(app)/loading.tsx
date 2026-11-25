import { Skeleton } from "@/core/ui/primitives/skeleton";

/**
 * Last-resort fallback for the shell. Every route under `(app)` has its own `loading.tsx` with
 * the shape of its own content (ARCHITECTURE §14.1), and Next uses the closest one, so this
 * should never actually appear — it exists so a route added without one degrades to something
 * neutral rather than to a stand-in borrowed from another screen.
 *
 * It deliberately draws no rows: guessing a shape here is what made Tasks show a People list.
 */
export default function AppLoading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <Skeleton className="h-11 w-40" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
