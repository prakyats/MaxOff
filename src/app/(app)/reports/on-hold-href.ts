/** One held project as the reports read it (`client_work_on_hold`): never an amount. */
export type HeldProject = { clientId: string; projectId: string; deliverables: number };

/**
 * Where "On hold · n deliverables" leads (v1.9 W8): the one held project itself, or the
 * cross-client deliverables list on its On hold filter when there are several.
 */
export function onHoldHref(held: readonly HeldProject[]): string {
  const [only, second] = held;
  if (only && !second) return `/clients/${only.clientId}/projects/${only.projectId}`;
  return "/clients/items?filter=on_hold";
}
