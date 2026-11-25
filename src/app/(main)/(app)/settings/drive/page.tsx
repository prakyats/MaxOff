import { CloudOffIcon } from "lucide-react";
import type { Metadata } from "next";

import { DisconnectDriveButton } from "@/core/drive/components/disconnect-drive-button";
import { readDriveEnv } from "@/core/drive/env";
import { readDriveStatus } from "@/core/drive/read";
import { outcomeLine, spaceView, stateLine } from "@/core/drive/status";
import { checkThenRead } from "@/core/lib/start-early";
import { cn } from "@/core/lib/utils";
import { requirePermission } from "@/core/permissions/server";
import { formatDateTime } from "@/core/time";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { PageHeader } from "@/core/ui/composites/page-header";
import { buttonVariants } from "@/core/ui/primitives/button-variants";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Google Drive" };

const CONNECT_HREF = "/api/drive/connect";

const STATE_WORDS = {
  connected: "Connected",
  needs_reconnect: "Needs reconnecting",
  disconnected: "Not connected",
} as const;

/**
 * Settings → Google Drive (v4.0, ADR-0010, `drive.manage`: the Owner only). First glance: is
 * the studio's Drive connected, which account, and how much space is left; the one action that
 * matters now (Connect, Reconnect) is the screen's solid button. Use another account and
 * Disconnect sit beside it. Without the Google settings on this environment, it says so and
 * offers nothing. Connect is a plain link: the Owner leaves for Google's own consent screen.
 */
export default async function DriveSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string | string[] }>;
}) {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [, status] = await checkThenRead(requirePermission("drive.manage"), readDriveStatus());
  const params = await searchParams;
  const setUp = readDriveEnv().mode === "on";
  const outcome = outcomeLine(typeof params.drive === "string" ? params.drive : null);
  const space = spaceView(status);

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Google Drive"
        {...SETTINGS_HEADERS.drive}
      />
      <div data-slot="drive-settings" className="flex max-w-md flex-col gap-6">
        {outcome ? (
          <p
            role="status"
            data-slot="drive-outcome"
            className={cn(
              "rounded-lg px-4 py-3 text-sm",
              outcome.tone === "success" ? "bg-success-soft" : "bg-danger-soft",
            )}
          >
            {outcome.text}
          </p>
        ) : null}

        {!setUp && status.state === "disconnected" ? (
          <EmptyState
            icon={CloudOffIcon}
            title="Not set up yet"
            description="Google Drive needs its Google sign-in settings on this environment before it can be connected."
          />
        ) : (
          <section
            aria-labelledby="drive-account"
            data-slot="drive-connection"
            className="border-border flex flex-col gap-4 rounded-lg border p-4"
          >
            <div className="flex flex-col gap-1">
              <h2 id="drive-account" className="text-sm font-medium">
                {STATE_WORDS[status.state]}
              </h2>
              {status.email && status.state !== "disconnected" ? (
                <p className="text-sm break-all" data-slot="drive-email">
                  {status.email}
                </p>
              ) : null}
              <p className="text-muted-foreground text-sm">{stateLine(status)}</p>
            </div>

            {status.state === "connected" ? (
              <div className="flex flex-col gap-2" data-slot="drive-space">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">Space</span>
                  {space ? (
                    <span
                      className={cn(
                        "text-sm",
                        space.level === "urgent" && "text-destructive font-medium",
                        space.level === "warning" && "text-attention font-medium",
                      )}
                    >
                      {space.line}
                    </span>
                  ) : null}
                </div>
                <div
                  role="meter"
                  aria-label="Google Drive space used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={space?.percent ?? 0}
                  aria-valuetext={
                    space ? `${space.percent}% used, ${space.line}` : "Not checked yet"
                  }
                  className="bg-muted h-2 overflow-hidden rounded-full"
                >
                  <div
                    className={cn(
                      "h-full rounded-full",
                      space?.level === "urgent"
                        ? "bg-destructive-solid"
                        : space?.level === "warning"
                          ? "bg-attention"
                          : "bg-foreground",
                    )}
                    style={{ width: `${space?.percent ?? 0}%` }}
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  {status.checkedAt
                    ? `Checked ${formatDateTime(status.checkedAt)}. MaxOff checks every morning and tells you at 80% and 90% full.`
                    : "Shown after the first check. MaxOff checks every morning and tells you at 80% and 90% full."}
                </p>
              </div>
            ) : null}

            {setUp ? (
              <div className="flex flex-col gap-2 sm:flex-row" data-slot="drive-actions">
                {status.state === "connected" ? (
                  <a
                    href={CONNECT_HREF}
                    data-variant="secondary"
                    data-size="default"
                    className={cn(buttonVariants({ variant: "secondary" }), "w-full sm:w-auto")}
                  >
                    Use another account
                  </a>
                ) : (
                  <a
                    href={CONNECT_HREF}
                    data-variant="primary"
                    data-size="default"
                    className={cn(buttonVariants({ variant: "primary" }), "w-full sm:w-auto")}
                  >
                    {status.state === "needs_reconnect" ? "Reconnect" : "Connect Google Drive"}
                  </a>
                )}
                {status.state !== "disconnected" ? <DisconnectDriveButton /> : null}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                The Google sign-in settings are missing on this environment, so it cannot be
                reconnected from here.
              </p>
            )}
          </section>
        )}
      </div>
    </>
  );
}
