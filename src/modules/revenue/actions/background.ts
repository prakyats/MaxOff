import "server-only";

import { assertPermission } from "@/core/permissions/server";

import * as repo from "../data/billing";
import type { HistoryEntry } from "../domain/history";
import { historySchema } from "../domain/schemas";

/** A page of the Billing history: its lines, and how many rows the read answered. */
export type BillingHistoryPage = { rows: number; entries: HistoryEntry[] };

/**
 * A page of a project's **Billing history** (v2.5, kickoff 9 Q7): `GET /api/revenue/billing-history`,
 * a **background call** (ARCHITECTURE §4.4: the section's history reads as it opens and on "Show
 * older", never through a server action that could hold a navigation). zod →
 * `assertPermission("finance.view")` (the Owner alone) → the repository, whose function refuses
 * anyone else too. The newest `limit` rows (20, then 20 more, at most 200), worded.
 */
export async function readBillingHistoryPage(input: unknown): Promise<BillingHistoryPage> {
  const query = historySchema.parse(input);
  await assertPermission("finance.view");
  return repo.readBillingHistory(query);
}
