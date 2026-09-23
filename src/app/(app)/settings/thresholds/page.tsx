import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getSettings, ThresholdsForm } from "@/modules/settings";

import { SettingsBackLink } from "../back-link";

export const metadata: Metadata = { title: "Thresholds" };

/**
 * Settings → Thresholds (PRODUCT §7, WORKFLOWS §9). The reminders and escalations that the
 * scheduled jobs read when they run: changing one never rewrites what already happened.
 */
export default async function ThresholdsSettingsPage() {
  await requirePermission("settings.manage");
  const settings = await getSettings();

  return (
    <>
      <SettingsBackLink />
      <PageHeader
        title="Thresholds"
        description="How long MaxOff waits before it reminds someone, escalates to the Admin and then to you, and how much email one person can get in a day."
      />
      <ThresholdsForm thresholds={settings} />
    </>
  );
}
