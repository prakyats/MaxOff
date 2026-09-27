import { z } from "zod";

import {
  BRAND_COLORS_MAX,
  BRAND_FONTS_MAX,
  BRAND_NOTES_MAX,
  BRAND_TONE_MAX,
  CLIENT_ADDRESS_MAX,
  CLIENT_CITY_MAX,
  CLIENT_CLOSE_REASON_MAX,
  CLIENT_LEGAL_NAME_MAX,
  CLIENT_NAME_MAX,
  CLIENT_OWNER_NOTES_MAX,
  CLIENT_PHONE_MAX,
  CLIENT_PHONE_MIN,
  CLIENT_TEXT_MAX,
  CLIENT_URL_MAX,
  CONTACT_DESIGNATION_MAX,
  CONTACT_NAME_MAX,
  GSTIN_PATTERN,
  HTTPS_URL_PATTERN,
} from "./limits";

/** "" from a form means "none"; the database stores null. */
function optionalText(max: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(max, tooLong)
    .optional()
    .transform((value) => (value ? value : null));
}

const clientName = z
  .string()
  .trim()
  .min(1, "A client name is required.")
  .max(CLIENT_NAME_MAX, `Keep the name under ${CLIENT_NAME_MAX} characters.`);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "That email address is too long.")
  .refine((value) => value.length === 0 || z.email().safeParse(value).success, {
    message: "Enter a valid email address.",
  })
  .optional()
  .transform((value) => (value ? value : null));

const phone = z
  .string()
  .trim()
  .max(CLIENT_PHONE_MAX, `Keep the phone number under ${CLIENT_PHONE_MAX} characters.`)
  .refine((value) => value.length === 0 || value.length >= CLIENT_PHONE_MIN, {
    message: "That phone number is too short.",
  })
  .optional()
  .transform((value) => (value ? value : null));

/** Website and Drive link: `https://` only (kickoff 3). */
const httpsUrl = z
  .string()
  .trim()
  .max(CLIENT_URL_MAX, "That link is too long.")
  .refine((value) => value.length === 0 || HTTPS_URL_PATTERN.test(value), {
    message: "Enter a full https:// link.",
  })
  .optional()
  .transform((value) => (value ? value : null));

/** Blocking when given, optional otherwise (kickoff 3). */
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => value.length === 0 || GSTIN_PATTERN.test(value), {
    message:
      "A GSTIN is 15 characters: 2 digits, the PAN, an entity number, Z and a check character.",
  })
  .optional()
  .transform((value) => (value ? value : null));

const optionalUuid = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((value) => (value ? value : null));

/** Values keyed by field key; `core/custom-fields` validates them against the definitions. */
const customFields = z.record(z.string(), z.unknown()).optional().default({});

const clientDetails = {
  name: clientName,
  legalName: optionalText(
    CLIENT_LEGAL_NAME_MAX,
    `Keep the legal name under ${CLIENT_LEGAL_NAME_MAX} characters.`,
  ),
  gstin,
  address: optionalText(
    CLIENT_ADDRESS_MAX,
    `Keep the address under ${CLIENT_ADDRESS_MAX} characters.`,
  ),
  city: optionalText(CLIENT_CITY_MAX, `Keep the city under ${CLIENT_CITY_MAX} characters.`),
  phone,
  email,
  website: httpsUrl,
  driveUrl: httpsUrl,
  requirements: optionalText(
    CLIENT_TEXT_MAX,
    `Keep the requirements under ${CLIENT_TEXT_MAX} characters.`,
  ),
  notes: optionalText(CLIENT_TEXT_MAX, `Keep the notes under ${CLIENT_TEXT_MAX} characters.`),
  customFields,
};

export const createClientSchema = z.object({ ...clientDetails, adminId: optionalUuid });
export type CreateClientInput = z.input<typeof createClientSchema>;

/**
 * A patch (3.4): only the keys a record sends are written, so two records of one client never
 * overwrite each other's values. A name, when sent, is still required and unique.
 */
export const updateClientSchema = z.object({
  clientId: z.uuid(),
  ...clientDetails,
  name: clientName.optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateClientInput = z.input<typeof updateClientSchema>;

export const clientIdSchema = z.object({ clientId: z.uuid() });
export type ClientIdInput = z.input<typeof clientIdSchema>;

export const closeClientSchema = z.object({
  clientId: z.uuid(),
  reason: optionalText(
    CLIENT_CLOSE_REASON_MAX,
    `Keep the reason under ${CLIENT_CLOSE_REASON_MAX} characters.`,
  ),
});
export type CloseClientInput = z.input<typeof closeClientSchema>;

export const assignClientAdminSchema = z.object({
  clientId: z.uuid(),
  adminId: z.uuid({ error: "Choose an Admin." }),
});
export type AssignClientAdminInput = z.input<typeof assignClientAdminSchema>;

export const updateOwnerNotesSchema = z.object({
  clientId: z.uuid(),
  ownerNotes: optionalText(
    CLIENT_OWNER_NOTES_MAX,
    `Keep the notes under ${CLIENT_OWNER_NOTES_MAX} characters.`,
  ),
});
export type UpdateOwnerNotesInput = z.input<typeof updateOwnerNotesSchema>;

const contactDetails = {
  name: z
    .string()
    .trim()
    .min(1, "A name is required.")
    .max(CONTACT_NAME_MAX, `Keep the name under ${CONTACT_NAME_MAX} characters.`),
  designation: optionalText(
    CONTACT_DESIGNATION_MAX,
    `Keep the designation under ${CONTACT_DESIGNATION_MAX} characters.`,
  ),
  email,
  phone,
  customFields,
};

export const createContactSchema = z.object({ clientId: z.uuid(), ...contactDetails });
export type CreateContactInput = z.input<typeof createContactSchema>;

export const updateContactSchema = z.object({ contactId: z.uuid(), ...contactDetails });
export type UpdateContactInput = z.input<typeof updateContactSchema>;

export const contactIdSchema = z.object({ contactId: z.uuid() });
export type ContactIdInput = z.input<typeof contactIdSchema>;

export const archiveContactSchema = z.object({
  contactId: z.uuid(),
  nextPrimaryId: optionalUuid,
});
export type ArchiveContactInput = z.input<typeof archiveContactSchema>;

/** A brand colour: a name and a hex value (DATA-MODEL §4). */
export const brandColorSchema = z.object({
  name: z.string().trim().min(1, "Name the colour.").max(60, "Keep the colour name short."),
  hex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "A colour is a 6-digit hex value like #E11D48.")
    .transform((value) => value.toUpperCase()),
});
export type BrandColor = z.output<typeof brandColorSchema>;

export const brandFontSchema = z.object({
  family: z.string().trim().min(1, "Name the font.").max(80, "Keep the font name short."),
  usage: optionalText(80, "Keep the usage short."),
});
export type BrandFont = z.output<typeof brandFontSchema>;

export const updateBrandSchema = z.object({
  clientId: z.uuid(),
  colors: z.array(brandColorSchema).max(BRAND_COLORS_MAX, `Up to ${BRAND_COLORS_MAX} colours.`),
  fonts: z.array(brandFontSchema).max(BRAND_FONTS_MAX, `Up to ${BRAND_FONTS_MAX} fonts.`),
  toneOfVoice: optionalText(BRAND_TONE_MAX, `Keep the tone under ${BRAND_TONE_MAX} characters.`),
  brandNotes: optionalText(BRAND_NOTES_MAX, `Keep the notes under ${BRAND_NOTES_MAX} characters.`),
});
export type UpdateBrandInput = z.input<typeof updateBrandSchema>;

export const setClientLogoSchema = z.object({ clientId: z.uuid(), fileId: z.uuid() });
export type SetClientLogoInput = z.input<typeof setClientLogoSchema>;

/** Parses what the database holds; a malformed row (never written by the app) reads as empty. */
export function parseBrandColors(value: unknown): BrandColor[] {
  const parsed = z.array(brandColorSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseBrandFonts(value: unknown): BrandFont[] {
  const parsed = z.array(brandFontSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}
