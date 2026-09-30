import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getSettings } from "@/modules/settings";
import { ThresholdsForm } from "@/modules/settings/components/thresholds-form";

import { SETTINGS_HEADERS } from "../headers";

export const metadata: Metadata = { title: "Thresholds" };

/**
 * Settings → Thresholds (PRODUCT §7, WORKFLOWS §9). The reminders and escalations that the
 * scheduled jobs read when they run: changing one never rewrites what already happened.
 */
export default async function ThresholdsSettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [, settings] = await checkThenRead(requirePermission("settings.manage"), getSettings());

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Thresholds"
        {...SETTINGS_HEADERS.thresholds}
      />
      <ThresholdsForm thresholds={settings} />
    </>
  );
}
