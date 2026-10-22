import { ReceiptIcon } from "lucide-react";
import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { withSessionUserId } from "@/core/auth/server";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { getClaimSetup, listOwnClaims } from "@/modules/expenses";
import { AddExpenseButton } from "@/modules/expenses/components/add-expense-button";
import { OwnClaimsList } from "@/modules/expenses/components/own-claims-list";

export const metadata: Metadata = { title: "Extra work & expenses" };

/**
 * The member's own expense claims (PRODUCT §4.18, WORKFLOWS §2a, 3b.3), the second view of
 * Extra work & expenses (5B; the layout holds the header and the tabs): **Add expense** and the claims,
 * newest expense first, each with where it stands. Claims are also added from End day. Only
 * whoever marks attendance opens it: the Owner has no claims, and an Admin sees only their own.
 */
export default async function ExpensesPage() {
  // Keyed by the session's id, so it starts with the session read (ARCHITECTURE §19).
  const [, claims] = await checkThenRead(
    requirePermission("attendance.self"),
    withSessionUserId(listOwnClaims),
  );
  const waiting = claims.filter((claim) => claim.state === "submitted").length;

  const add = (primary: boolean) => (
    <AddExpenseButton
      today={todayIST()}
      setup={getClaimSetup().catch(() => null)}
      primary={primary}
    />
  );
  // PP-crew-10 / FINAL 7 (V5b): with no claims the empty state teaches and offers the one action,
  // Add expense, inside it; an empty list takes no heading row.
  if (claims.length === 0) {
    return (
      <EmptyState
        icon={ReceiptIcon}
        title="No expense claims yet"
        description="Spent your own money on work? Add it here or when you end your day, and the Owner pays it back."
        action={add(true)}
      />
    );
  }

  return (
    <>
      <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Expense claims <span className="tabular-nums">{claims.length}</span>
          {waiting > 0 ? <span className="tabular-nums"> · {waiting} waiting</span> : null}
        </h2>
        {add(false)}
      </div>
      <OwnClaimsList claims={claims} />
    </>
  );
}
