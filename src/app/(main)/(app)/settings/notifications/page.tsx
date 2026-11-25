import { AlertTriangleIcon, BellRingIcon } from "lucide-react";
import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { ReachabilityList } from "@/core/notifications/components/reachability-list";
import { operationalWarning } from "@/core/notifications/env";
import { readReachability } from "@/core/notifications/reachability-store";
import { requirePermission } from "@/core/permissions/server";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Settings → Notifications (task 5.4; WORKFLOWS §9a "Reachability", PERMISSIONS
 * `notifications.reachability`). First glance: the people MaxOff can't reach by push and why.
 * The Owner sees everyone, with the device and the last delivery that worked, and any server
 * setting push or email is missing (names only); an Admin sees the people on their open tasks,
 * status and reason only (the database decides both). Nobody ever sees an endpoint.
 */
export default async function NotificationsSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [viewer, rows] = await checkThenRead(
    requirePermission("notifications.reachability"),
    readReachability(),
  );
  const owner = viewer.role === "owner";
  const unreachable = rows.filter((row) => row.state !== "ok");
  // Read at runtime on the server, never sent as values: only the names reach the page.
  const warning = owner ? operationalWarning() : null;

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Notifications"
        {...SETTINGS_HEADERS.notifications}
      />
      <div data-slot="reachability" className="flex max-w-2xl flex-col gap-6">
        <section aria-labelledby="unreachable" className="flex flex-col gap-3">
          <h2 id="unreachable" className="text-sm font-medium">
            Can&rsquo;t be reached
          </h2>
          {unreachable.length > 0 ? (
            <ReachabilityList rows={unreachable} detailed={owner} label="Can't be reached" />
          ) : (
            <EmptyState
              icon={BellRingIcon}
              title={
                owner ? "Everyone can be reached." : "Everyone on your open tasks can be reached."
              }
              description="Their notifications arrive on at least one device."
            />
          )}
        </section>

        {warning ? (
          <section
            data-slot="operational-warning"
            role="status"
            className="border-attention/40 bg-attention-soft text-attention flex gap-3 rounded-lg border p-4"
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <p className="font-medium">Notifications are not fully set up on the server</p>
              {warning.missing.length > 0 ? (
                <p className="break-words">Not set: {warning.missing.join(", ")}.</p>
              ) : null}
              {warning.invalid.length > 0 ? (
                <p className="break-words">Set but not valid: {warning.invalid.join(", ")}.</p>
              ) : null}
              <p className="text-foreground">
                Until they are set in the hosting settings, push or email can&rsquo;t go out.
              </p>
            </div>
          </section>
        ) : null}

        {owner ? (
          <section aria-labelledby="everyone" className="flex flex-col gap-3">
            <h2 id="everyone" className="text-sm font-medium">
              Everyone
            </h2>
            <ReachabilityList rows={rows} detailed label="Everyone" />
          </section>
        ) : null}
      </div>
    </>
  );
}
