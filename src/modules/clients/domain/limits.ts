/**
 * Input limits the client forms show in the browser (`maxLength`, the choices offered). Kept
 * apart from `schemas.ts` so a client component can use them without bundling zod (task 2.8);
 * the schemas import them from here, so both sides keep one number. The table's own checks say
 * the same (migration 3.1).
 */

export const CLIENT_NAME_MAX = 120;
export const CLIENT_LEGAL_NAME_MAX = 200;
export const CLIENT_ADDRESS_MAX = 500;
export const CLIENT_CITY_MAX = 120;
export const CLIENT_PHONE_MIN = 3;
export const CLIENT_PHONE_MAX = 32;
export const CLIENT_URL_MAX = 500;
export const CLIENT_TEXT_MAX = 5000;
export const CLIENT_OWNER_NOTES_MAX = 10000;
export const CLIENT_CLOSE_REASON_MAX = 1000;
export const CONTACT_NAME_MAX = 120;
export const CONTACT_DESIGNATION_MAX = 120;
export const BRAND_TONE_MAX = 2000;
export const BRAND_NOTES_MAX = 5000;
export const BRAND_COLORS_MAX = 12;
export const BRAND_FONTS_MAX = 6;

/** The 15-character GSTIN: state code, PAN, entity number, Z, check character (kickoff 3). */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Website and Drive link are `https://` URLs and nothing more (kickoff 3). */
export const HTTPS_URL_PATTERN = /^https:\/\/\S+$/;
