import type { Metadata } from "next";

import { checkThenRead } from "@/core/lib/start-early";
import { requirePermission } from "@/core/permissions/server";
import { PageHeader } from "@/core/ui/composites/page-header";
import { getCompany } from "@/modules/settings";
import { CompanyForm } from "@/modules/settings/components/company-form";
import { CompanyLogoCard } from "@/modules/settings/components/company-logo-card";

export const metadata: Metadata = { title: "Company" };

/** Settings → Company (PRODUCT §4.16): the name, the timezone and the logo (3.3). */
export default async function CompanySettingsPage() {
  // Read together with the permission check, not after it (ARCHITECTURE §19).
  const [, company] = await checkThenRead(requirePermission("settings.manage"), getCompany());

  return (
    <>
      <PageHeader
        back={{ href: "/settings", label: "Settings" }}
        title="Company"
        description="The name people see across MaxOff, and the timezone every date is read in."
        help="MaxOff runs on IST everywhere. The company name is what people see across the app."
      />
      <div className="flex max-w-md flex-col gap-6">
        <CompanyLogoCard name={company.name} logoFileId={company.logoFileId} />
        <CompanyForm company={company} />
      </div>
    </>
  );
}
