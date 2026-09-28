import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { getClaimSetup, listOwnClaims } from "@/modules/expenses";
import { AddExpenseButton } from "@/modules/expenses/components/add-expense-button";
import { OwnClaimsList } from "@/modules/expenses/components/own-claims-list";

export const metadata: Metadata = { title: "Attendance & leave" };

/**
 * The member's own expense claims (PRODUCT §4.18, WORKFLOWS §2a, 3b.3), a fourth view of
 * Attendance & leave (the layout holds the header and the tabs): **Add expense** and the claims,
 * newest expense first, each with where it stands. Claims are also added from End day. Only
 * whoever marks attendance opens it: the Owner has no claims, and an Admin sees only their own.
 */
export default async function ExpensesPage() {
  const viewer = await requirePermission("attendance.self");
  const claims = await listOwnClaims(viewer.id);
  const waiting = claims.filter((claim) => claim.state === "submitted").length;

  return (
    <>
      <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Expense claims <span className="tabular-nums">{claims.length}</span>
          {waiting > 0 ? <span className="tabular-nums"> · {waiting} waiting</span> : null}
        </h2>
        <AddExpenseButton today={todayIST()} setup={getClaimSetup().catch(() => null)} />
      </div>
      <OwnClaimsList claims={claims} />
    </>
  );
}
