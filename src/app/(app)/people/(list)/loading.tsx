import { getCurrentMember } from "@/core/auth/server";
import { can } from "@/core/permissions";
import { PageLoading } from "@/core/ui/composites/loading-state";

/**
 * People renders `DataTable` with a `mobile` card spec, so the load traces those cards.
 *
 * In the `(list)` route group on purpose (2.9): a `loading.tsx` wraps its page **and every child
 * segment**, so at `people/` it was also the boundary for `/people/[id]`, and a tap that beat the
 * prefetch (a board row on a freshly loaded Today) flashed the People list's skeleton before the
 * person. `/people/[id]` has its own layout and skeleton.
 */
export default async function Loading() {
  // Every card leads with the person's 40 px photo (V5b-D). An Admin's card has two more lines,
  // Today and Next booked (v6.5 unit 13). The layout already read the member (`cache()`).
  const member = await getCurrentMember();
  const admin =
    member !== null && !can(member.role, "team.manage") && can(member.role, "availability.view");
  return <PageLoading title="People" shape="cards" avatars subtitleLines={admin ? 3 : 1} />;
}
