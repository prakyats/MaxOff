import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { LIST_LABELS } from "@/core/lists";
import { listItems } from "@/core/lists/server";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getReceiptAbove } from "@/modules/expenses";
import { ReceiptAboveForm } from "@/modules/expenses/components/receipt-above-form";
import { ListManager } from "@/modules/settings/components/list-manager";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Expenses" };

/**
 * Settings → Expenses (PRODUCT §4.18, decisions 22 and 23; 3b.3): the Owner's category list
 * (seeded Travel, Food, Materials, Other; archived ones leave the form and stay on old claims)
 * and the receipt amount (default ₹500). The Owner's alone (`expenses.decide`): an Admin's
 * `lists.manage` does not reach this list, in the database either.
 */
export default async function ExpensesSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [, [items, receiptAbove]] = await checkThenRead(
    requirePermission("expenses.decide"),
    Promise.all([listItems("expense_category", { includeArchived: true }), getReceiptAbove()]),
  );

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Expenses"
        {...SETTINGS_HEADERS.expenses}
      />
      <div className="flex max-w-2xl flex-col gap-8">
        <section aria-labelledby="expense-categories" className="flex flex-col gap-3">
          <h2 id="expense-categories" className="text-sm font-medium">
            Categories
          </h2>
          <ListManager
            listKey="expense_category"
            labels={LIST_LABELS.expense_category}
            items={items.map((item) => ({
              id: item.id,
              name: item.name,
              archivedAt: item.archived_at,
            }))}
          />
        </section>
        <section aria-labelledby="expense-receipts" className="flex flex-col gap-3">
          <h2 id="expense-receipts" className="text-sm font-medium">
            Receipts
          </h2>
          <ReceiptAboveForm receiptAbove={receiptAbove} />
        </section>
      </div>
    </>
  );
}
