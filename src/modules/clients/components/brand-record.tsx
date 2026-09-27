"use client";

import { ImageUploadSheet } from "@/core/storage/components/image-upload-sheet";
import { EditableRecord } from "@/core/ui/composites/editable-record";

import { removeClientLogo, setClientLogo, updateBrandText } from "../actions/clients";
import { colorLines, fontLines } from "../domain/brand-lines";
import type { ClientBrand } from "../domain/clients";
import { BRAND_NOTES_MAX, BRAND_TONE_MAX } from "../domain/limits";

type Field = "colors" | "fonts" | "toneOfVoice" | "brandNotes";

/**
 * A client's light brand kit (3.4, PRODUCT §4.4) through the edit pattern: colours (one per
 * line, "Primary #E11D48", drawn as swatches), fonts ("Inter: headings"), tone of voice and
 * brand notes. These are the basics Staff see on client-labelled tasks (`client_labels`, 4.1).
 */
export function BrandRecord({
  clientId,
  clientName,
  brand,
  canEdit,
}: {
  clientId: string;
  clientName: string;
  brand: ClientBrand;
  canEdit: boolean;
}) {
  return (
    <EditableRecord<Field>
      title="Brand"
      subject={clientName}
      canEdit={canEdit}
      savedMessage="Brand saved"
      fields={[
        {
          name: "colors",
          label: "Colours",
          noun: "brand colours",
          value: colorLines(brand.colors),
          kind: "textarea",
          display: "swatches",
          rows: 4,
          hint: "One per line: a name and a hex value, like Primary #E11D48.",
          emptyLabel: "No colours yet",
        },
        {
          name: "fonts",
          label: "Fonts",
          noun: "fonts",
          value: fontLines(brand.fonts),
          kind: "textarea",
          display: "multiline",
          rows: 3,
          hint: "One per line, with what it is for after a colon, like Inter: headings.",
          emptyLabel: "No fonts yet",
        },
        {
          name: "toneOfVoice",
          label: "Tone of voice",
          noun: "tone of voice",
          value: brand.toneOfVoice,
          kind: "textarea",
          display: "multiline",
          rows: 3,
          input: { maxLength: BRAND_TONE_MAX },
        },
        {
          name: "brandNotes",
          label: "Brand notes",
          noun: "brand notes",
          value: brand.brandNotes,
          kind: "textarea",
          display: "multiline",
          rows: 4,
          input: { maxLength: BRAND_NOTES_MAX },
        },
      ]}
      onSave={(values) => updateBrandText({ clientId, ...values })}
    />
  );
}

/**
 * The logo (3.3's upload protocol, kickoff 3 decision 11): ≤ 5 MB PNG / JPEG / WebP / SVG (an SVG
 * sanitised); the original is kept and the browser makes the preview lists show. Its own sheet,
 * so its red Save never sits beside the brand record's.
 */
export function ClientLogoEditor({
  clientId,
  clientName,
  hasLogo,
}: {
  clientId: string;
  clientName: string;
  hasLogo: boolean;
}) {
  return (
    <div data-slot="client-logo-editor">
      <ImageUploadSheet
        purpose="logo"
        title={`${clientName} logo`}
        triggerLabel={hasLogo ? "Change logo" : "Add logo"}
        saveLabel="Save logo"
        removeLabel="Remove logo"
        hasCurrent={hasLogo}
        onSave={({ fileId }) => setClientLogo({ clientId, fileId })}
        onRemove={() => removeClientLogo({ clientId })}
      />
    </div>
  );
}
