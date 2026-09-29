/**
 * What an auth link carries (ADR-0012): `/auth/confirm?token_hash=…&type=…`. Pure, so the
 * Continue page (which only shows the link), the action behind Continue (which verifies it) and
 * the tests share one reading of the query string.
 */

/** Only the links a MaxOff template issues: GoTrue's recovery email and the app's invite. */
export const LINK_TYPES = ["recovery", "invite"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export type AuthLinkParams = { tokenHash: string; type: LinkType };

/** Query values as Next hands them over: absent, one, or repeated. */
type QueryValue = string | readonly string[] | null | undefined;

function isLinkType(value: string): value is LinkType {
  return (LINK_TYPES as readonly string[]).includes(value);
}

/**
 * The link's token hash and type, or null when either is missing, repeated or not something a
 * MaxOff template issues. The hash is not decoded here (GoTrue compares it as sent); it only
 * has to be one printable ASCII word of a sane length, which every hash GoTrue issues is.
 */
export function parseAuthLinkParams(params: {
  tokenHash: QueryValue;
  type: QueryValue;
}): AuthLinkParams | null {
  const { tokenHash, type } = params;
  if (typeof tokenHash !== "string" || typeof type !== "string") return null;
  if (!/^[\x21-\x7e]{1,512}$/.test(tokenHash)) return null;
  if (!isLinkType(type)) return null;
  return { tokenHash, type };
}
