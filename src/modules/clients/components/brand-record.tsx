"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { ImageUploadSheet } from "@/core/storage/components/image-upload-sheet";
import { EditableRecord, type EditableExtra } from "@/core/ui/composites/editable-record";
import { ErrorText } from "@/core/ui/composites/error-text";
import { possessive } from "@/core/ui/edit/changes";
import { Button } from "@/core/ui/primitives/button";
import { Input } from "@/core/ui/primitives/input";

import { removeClientLogo, setClientLogo, updateBrand } from "../actions/clients";
import {
  type BrandDraft,
  brandChanges,
  brandDraft,
  brandPayload,
  type ColorRow,
  type FontRow,
  hexInput,
  isHex,
  moveRow,
} from "../domain/brand-changes";
import type { ClientBrand } from "../domain/clients";
import {
  BRAND_COLORS_MAX,
  BRAND_FONTS_MAX,
  BRAND_NOTES_MAX,
  BRAND_TONE_MAX,
} from "../domain/limits";

type Field = "toneOfVoice" | "brandNotes";

const GROUP_LABEL = "text-muted-foreground text-sm";

/**
 * A client's light brand kit (3.4, PRODUCT §4.4) through the edit pattern. **Colours are a
 * swatch list** (a chip, a name and the hex; tapping a row copies the hex) and **fonts a simple
 * list** (a name and an optional note), both edited as rows — a colour picker plus a hex field,
 * add, remove and reorder — in the same draft, Save and named-change confirmation as tone of
 * voice and brand notes (owner decision 2026-09-27, 3B review). These are the basics Staff see
 * on client-labelled tasks (`client_labels`, 4.1).
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
  const extra: EditableExtra<BrandDraft> = {
    value: brandDraft(brand.colors, brand.fonts),
    first: true,
    changes: (before, after) => brandChanges(possessive(clientName), before, after),
    owns: (key) => /^(colors|fonts)(\.|$)/.test(key),
    edit: ({ value, onChange, errors }) => (
      <BrandListsEditor value={value} onChange={onChange} errors={errors} />
    ),
    read: (value) => <BrandLists value={value} />,
  };

  return (
    <EditableRecord<Field, BrandDraft>
      title="Brand"
      subject={clientName}
      canEdit={canEdit}
      savedMessage="Brand saved"
      extra={extra}
      fields={[
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
      onSave={(values, draft) => updateBrand({ clientId, ...values, ...brandPayload(draft) })}
    />
  );
}

async function copyHex(row: ColorRow) {
  try {
    await navigator.clipboard.writeText(row.hex);
    toast.success(`Copied ${row.hex}`, { description: row.name });
  } catch {
    toast.error("Could not copy", { description: `The hex value is ${row.hex}.` });
  }
}

/** Read mode: the swatch list (each row copies its hex) and the font list. */
function BrandLists({ value }: { value: BrandDraft }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div data-slot="brand-colors">
        <p className={GROUP_LABEL}>Colours</p>
        {value.colors.length === 0 ? (
          <p className="text-muted-foreground">No colours yet</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {value.colors.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  data-slot="brand-color"
                  aria-label={`${row.name} ${row.hex}. Copy the hex value`}
                  onClick={() => copyHex(row)}
                  className="pressable hover:bg-muted/60 focus-visible:ring-ring -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2"
                >
                  <span
                    aria-hidden
                    data-slot="swatch"
                    className="border-border size-8 shrink-0 rounded-md border"
                    style={{ backgroundColor: row.hex }}
                  />
                  <span className="min-w-0 flex-1 font-medium break-words">{row.name}</span>
                  <span className="text-muted-foreground shrink-0 font-mono">{row.hex}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div data-slot="brand-fonts">
        <p className={GROUP_LABEL}>Fonts</p>
        {value.fonts.length === 0 ? (
          <p className="text-muted-foreground">No fonts yet</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-2">
            {value.fonts.map((row) => (
              <li key={row.key} data-slot="brand-font" className="min-w-0 break-words">
                <p className="font-medium">{row.family}</p>
                {row.usage ? <p className="text-muted-foreground">{row.usage}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

let nextKey = 0;
const newKey = (prefix: string) => `${prefix}-new-${(nextKey += 1)}`;

function errorFor(errors: Record<string, string[]>, key: string): string | undefined {
  return errors[key]?.[0];
}

/** Up, down and remove for one row: neutral icon buttons (a removal is only a draft until Save). */
function RowTools({
  index,
  count,
  what,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  what: string;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Move ${what} up`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Move ${what} down`}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${what}`}
        onClick={onRemove}
      >
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

/** Edit mode: the colour rows and the font rows, each with add, remove and reorder. */
function BrandListsEditor({
  value,
  onChange,
  errors,
}: {
  value: BrandDraft;
  onChange: (next: BrandDraft) => void;
  errors: Record<string, string[]>;
}) {
  const setColors = (colors: ColorRow[]) => onChange({ ...value, colors });
  const setFonts = (fonts: FontRow[]) => onChange({ ...value, fonts });
  const editColor = (index: number, patch: Partial<ColorRow>) =>
    setColors(value.colors.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const editFont = (index: number, patch: Partial<FontRow>) =>
    setFonts(value.fonts.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const colorsError = errorFor(errors, "colors");
  const fontsError = errorFor(errors, "fonts");

  return (
    <>
      <fieldset data-slot="brand-colors-editor" className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Colours</legend>
        {value.colors.length === 0 ? (
          <p className="text-muted-foreground text-sm">No colours yet</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {value.colors.map((row, index) => {
              const what = `colour ${index + 1}`;
              const nameError = errorFor(errors, `colors.${index}.name`);
              const hexError = errorFor(errors, `colors.${index}.hex`);
              return (
                <li
                  key={row.key}
                  data-slot="brand-color-row"
                  className="flex flex-col gap-2 rounded-lg border p-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={`Colour ${index + 1} picker`}
                      value={isHex(row.hex) ? row.hex.toLowerCase() : "#000000"}
                      onChange={(event) => editColor(index, { hex: hexInput(event.target.value) })}
                      className="border-control-border size-11 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 text-base"
                    />
                    <Input
                      aria-label={`Colour ${index + 1} name`}
                      placeholder="Name, like Primary"
                      value={row.name}
                      maxLength={60}
                      aria-invalid={nameError ? true : undefined}
                      onChange={(event) => editColor(index, { name: event.target.value })}
                      className="min-w-0 flex-1"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={`Colour ${index + 1} hex`}
                      placeholder="#E11D48"
                      value={row.hex}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={hexError ? true : undefined}
                      onChange={(event) => editColor(index, { hex: hexInput(event.target.value) })}
                      className="w-32 font-mono"
                    />
                    <RowTools
                      index={index}
                      count={value.colors.length}
                      what={what}
                      onMove={(by) => setColors(moveRow(value.colors, index, by))}
                      onRemove={() => setColors(value.colors.filter((_, at) => at !== index))}
                    />
                  </div>
                  {nameError ? <ErrorText>{nameError}</ErrorText> : null}
                  {hexError ? <ErrorText>{hexError}</ErrorText> : null}
                </li>
              );
            })}
          </ol>
        )}
        {colorsError ? <ErrorText>{colorsError}</ErrorText> : null}
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={value.colors.length >= BRAND_COLORS_MAX}
          onClick={() =>
            setColors([...value.colors, { key: newKey("c"), name: "", hex: "#000000" }])
          }
        >
          <PlusIcon aria-hidden />
          Add colour
        </Button>
      </fieldset>

      <fieldset data-slot="brand-fonts-editor" className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Fonts</legend>
        {value.fonts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No fonts yet</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {value.fonts.map((row, index) => {
              const what = `font ${index + 1}`;
              const familyError = errorFor(errors, `fonts.${index}.family`);
              const usageError = errorFor(errors, `fonts.${index}.usage`);
              return (
                <li
                  key={row.key}
                  data-slot="brand-font-row"
                  className="flex flex-col gap-2 rounded-lg border p-2"
                >
                  <Input
                    aria-label={`Font ${index + 1} name`}
                    placeholder="Font name, like Inter"
                    value={row.family}
                    maxLength={80}
                    aria-invalid={familyError ? true : undefined}
                    onChange={(event) => editFont(index, { family: event.target.value })}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={`Font ${index + 1} note`}
                      placeholder="Note (optional), like headings"
                      value={row.usage}
                      maxLength={80}
                      aria-invalid={usageError ? true : undefined}
                      onChange={(event) => editFont(index, { usage: event.target.value })}
                      className="min-w-0 flex-1 basis-40"
                    />
                    <RowTools
                      index={index}
                      count={value.fonts.length}
                      what={what}
                      onMove={(by) => setFonts(moveRow(value.fonts, index, by))}
                      onRemove={() => setFonts(value.fonts.filter((_, at) => at !== index))}
                    />
                  </div>
                  {familyError ? <ErrorText>{familyError}</ErrorText> : null}
                  {usageError ? <ErrorText>{usageError}</ErrorText> : null}
                </li>
              );
            })}
          </ol>
        )}
        {fontsError ? <ErrorText>{fontsError}</ErrorText> : null}
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={value.fonts.length >= BRAND_FONTS_MAX}
          onClick={() => setFonts([...value.fonts, { key: newKey("f"), family: "", usage: "" }])}
        >
          <PlusIcon aria-hidden />
          Add font
        </Button>
      </fieldset>
    </>
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
