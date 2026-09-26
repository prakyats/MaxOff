import type { Metadata } from "next";

import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getCompany } from "@/modules/settings";
import { CompanyForm } from "@/modules/settings/components/company-form";

export const metadata: Metadata = { title: "Company" };

/** Settings → Company (PRODUCT §4.16). The logo joins with file storage in 3.3. */
export default async function CompanySettingsPage() {
  await requirePermission("settings.manage");
  const company = await getCompany();

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Company"
        description="The name people see across MaxOff, and the timezone every date is read in."
        help="MaxOff runs on IST everywhere. The company name is what people see across the app."
      />
      <CompanyForm company={company} />
    </>
  );
}
