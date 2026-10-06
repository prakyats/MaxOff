"use client";

import { useEffect, useState } from "react";

import { cn } from "@/core/lib/utils";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { Button } from "@/core/ui/primitives/button";
import { toastResult } from "@/core/ui/toast";

import { removeDevice } from "../actions";
import { browserSubscription, currentPermission, currentSupport } from "../push/browser";
import type { DeviceRow } from "../push/device-list";

/**
 * Me's device list (task 5.5, owner decision 2026-10-03, 5): every device of the member, by its
 * plain-words name, platform, last notification and, for one that stopped, why. **This device**
 * is marked and keeps "Sign out of this device" (the row above); every other device has
 * **Remove**, which stops notifications there without signing it out, behind a confirmation whose
 * red button names the device ("Remove Chrome on Android"). Never an endpoint or an id on the
 * screen: the endpoint only tells this device apart, in the browser.
 *
 * Until this device is known the Remove buttons hold their place invisibly, so nothing moves.
 */
export function DeviceList({ rows }: { rows: readonly DeviceRow[] }) {
  // undefined = still checking; null = this browser has no subscription.
  const [here, setHere] = useState<string | null | undefined>(undefined);
  const [removing, setRemoving] = useState<DeviceRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (currentSupport().kind !== "ready" || currentPermission() !== "granted") return null;
      return (await browserSubscription())?.endpoint ?? null;
    })()
      .then((endpoint) => {
        if (!cancelled) setHere(endpoint);
      })
      .catch(() => {
        if (!cancelled) setHere(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows.length === 0) {
    return (
      <p data-slot="device-list-empty" className="text-muted-foreground text-sm">
        No device gets notifications yet.
      </p>
    );
  }
  return (
    <>
      <ul data-slot="device-list" aria-label="Your devices" className="flex flex-col gap-4">
        {rows.map((row) => {
          const isHere = here !== undefined && here === row.endpoint;
          return (
            <li
              key={row.id}
              data-slot="device-row"
              data-active={row.active ? "true" : "false"}
              data-here={isHere ? "true" : undefined}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
            >
              <div className="flex min-w-0 flex-[1_1_10rem] flex-col text-sm">
                <p className="font-medium break-words">{row.name}</p>
                <p className="text-muted-foreground">{row.detail}</p>
                <p className="text-muted-foreground">{row.delivery}</p>
                {row.problem ? (
                  <p data-slot="device-problem" className="text-foreground">
                    {row.problem}
                  </p>
                ) : null}
              </div>
              {/* The trailing slot: "This device", or Remove (held invisibly while checking). */}
              <div className="grid shrink-0 justify-items-end">
                {isHere ? (
                  <span
                    data-slot="device-here"
                    className="text-muted-foreground col-start-1 row-start-1 self-center text-sm"
                  >
                    This device
                  </span>
                ) : (
                  <Button
                    variant="destructive"
                    className={cn("col-start-1 row-start-1", here === undefined && "invisible")}
                    aria-hidden={here === undefined ? true : undefined}
                    tabIndex={here === undefined ? -1 : undefined}
                    onClick={() => setRemoving(row)}
                    aria-label={`Remove ${row.name}`}
                    data-slot="device-remove"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing ? `Remove ${removing.name}?` : "Remove this device?"}
        description="It stops getting notifications. It stays signed in: to sign it out, use “Sign out of this device” on it."
        confirmLabel={removing ? `Remove ${removing.name}` : "Remove"}
        pendingLabel="Removing…"
        onConfirm={async () => {
          if (!removing) return;
          const result = await removeDevice({ id: removing.id });
          return toastResult(result, { success: `${removing.name} removed` }) ? undefined : false;
        }}
      />
    </>
  );
}
