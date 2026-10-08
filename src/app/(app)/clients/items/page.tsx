import type { Metadata } from "next";

import { startEarly } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { todayIST } from "@/core/time";
import { PageHeader } from "@/core/ui/composites/page-header";
import { itemRowView, listItemRows, sortItemRows } from "@/modules/client-work";
import { ItemList, type ItemListFilter } from "@/modules/client-work/components/item-list";

import { loadPeople } from "../[id]/client";

import { itemsDescription } from "./copy";

export const metadata: Metadata = { title: "Client items" };

const FILTERS: readonly ItemListFilter[] = ["live", "overdue", "open", "done"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The cross-client item list (7.3 / 7.4; PRODUCT §4.7, kickoff 7 decision 19, amendment C E1;
 * PERMISSIONS "Screens (phase 7)": `items.tick`, RLS decides the rows): every open and done item of
 * the clients the viewer runs (an Admin) or of every client (the Owner, **grouped by Admin**),
 * overdue first. `?filter=overdue` is where the Owner's Today count and his E1 escalation land
 * (`app.client_items_overdue_link()`); `?client=` and `?project=` narrow it. A drill-down from
 * Today, Clients or a notification: back returns there.
 */
export default async function ClientItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const reads = Promise.all([listItemRows({ states: ["open", "done"] }), loadPeople()]);
  startEarly(reads);
  const [viewer, params] = await Promise.all([requirePermission("items.tick"), searchParams]);
  const [rows, people] = await reads;
  const today = todayIST();
  const filter = first(params.filter);
  const owner = viewer.role === "owner";
  const description = itemsDescription(owner);

  return (
    <>
      <PageHeader
        title="Client items"
        description={description}
        help={description}
        back={{ href: owner ? "/today" : "/clients", label: owner ? "Today" : "Clients" }}
      />
      <div className="max-w-3xl">
        <ItemList
          rows={sortItemRows(rows).map((row) => itemRowView(row, today))}
          grouped={owner}
          adminNames={people.names}
          initial={{
            filter: FILTERS.find((value) => value === filter) ?? "live",
            client: first(params.client) ?? "all",
            project: first(params.project) ?? "all",
          }}
        />
      </div>
    </>
  );
}
