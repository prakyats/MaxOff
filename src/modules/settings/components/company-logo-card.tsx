"use client";

import { Building2Icon } from "lucide-react";

import { ImageUploadSheet } from "@/core/storage/components/image-upload-sheet";
import { FileImage } from "@/core/storage/components/file-image";

import { removeCompanyLogo, setCompanyLogo } from "../actions/settings";

/**
 * Settings → Company: the logo (task 3.3, PRODUCT §4.16). The current preview (or a
 * placeholder) beside one trigger, "Change logo", whose sheet is where the file is picked and
 * saved (its own layer, so the form's red "Save company" stays the screen's only one).
 */
export function CompanyLogoCard({ name, logoFileId }: { name: string; logoFileId: string | null }) {
  return (
    <section
      data-slot="company-logo"
      className="border-border flex items-center gap-4 rounded-lg border p-4"
      aria-label="Company logo"
    >
      <div className="bg-muted flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        {logoFileId ? (
          <FileImage fileId={logoFileId} alt={`${name} logo`} className="size-full" />
        ) : (
          <Building2Icon className="text-muted-foreground size-8" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">Logo</p>
        <p className="text-muted-foreground text-sm">
          {logoFileId
            ? "Shown where the company is named. Replacing it keeps the old file for 30 days."
            : "PNG, JPEG, WebP or SVG up to 5 MB. Shown where the company is named."}
        </p>
        <div>
          <ImageUploadSheet
            purpose="logo"
            title="Company logo"
            triggerLabel={logoFileId ? "Change logo" : "Add logo"}
            saveLabel="Save logo"
            removeLabel="Remove logo"
            hasCurrent={logoFileId !== null}
            onSave={({ fileId }) => setCompanyLogo({ fileId })}
            onRemove={() => removeCompanyLogo()}
          />
        </div>
      </div>
    </section>
  );
}
