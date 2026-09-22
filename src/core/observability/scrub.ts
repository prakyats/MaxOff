import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/**
 * ARCHITECTURE §18: error reports never carry money or personal data. Everything below runs
 * before an event leaves the app, on every runtime (server, edge, browser).
 *
 * - Request bodies, form data, cookies, headers and query strings are dropped; URLs are
 *   reduced to their path.
 * - The user is reduced to `{ id }` (a member id), never a name, email or IP.
 * - Any field whose key looks financial is replaced, however deep it sits, and rupee amounts,
 *   email addresses and Indian phone numbers are replaced inside every string.
 *   Scrubbing too much is fine; too little is not.
 */
export const FINANCIAL_KEY = /amount|value|billing|revenue|price|rate|fee|inr|money/i;
export const SCRUBBED = "[scrubbed]";
const STRING_PATTERNS: RegExp[] = [
  /₹\s?[\d,.]*/g, // ₹12,000 (or a bare rupee sign)
  /\b(?:Rs\.?|INR)\s?[\d,.]+/g, // Rs. 500, Rs 500, INR 12,000
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // email addresses
  /(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, // Indian mobile numbers
];
const MAX_DEPTH = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Replaces money, emails and phone numbers inside a string; the rest of the message stays. */
export function scrubString(value: string): string {
  return STRING_PATTERNS.reduce((text, pattern) => text.replace(pattern, SCRUBBED), value);
}

/** Origin + path only: query strings and fragments can carry filter values or search text. */
export function scrubUrl(value: string): string {
  try {
    const url = new URL(value, "http://relative.invalid");
    const path = url.pathname;
    return url.origin === "http://relative.invalid" ? path : `${url.origin}${path}`;
  } catch {
    return SCRUBBED;
  }
}

/**
 * Keys whose string value is a URL or a path with a possible query string, wherever they sit.
 * `request_path` is what `@sentry/nextjs` puts in `contexts.nextjs` for `onRequestError`; the
 * staging diagnostic showed it carrying the full query string (ARCHITECTURE §18.2).
 */
const URL_KEYS = new Set(["url", "from", "to", "href", "request_path"]);

/**
 * Recursively replaces financial keys, reduces URL keys to origin + path and scrubs strings.
 * Leaves everything else untouched.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubString(value);
  if (depth >= MAX_DEPTH) return SCRUBBED;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (FINANCIAL_KEY.test(key)) out[key] = SCRUBBED;
      else if (URL_KEYS.has(key) && typeof inner === "string") out[key] = scrubUrl(inner);
      else out[key] = scrubValue(inner, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubData(data: Record<string, unknown>): Record<string, unknown> {
  return scrubValue(data) as Record<string, unknown>;
}

/**
 * `beforeBreadcrumb`: network breadcrumbs keep method, status and path only; navigation
 * breadcrumbs keep paths; everything else is scrubbed like event data.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const out: Breadcrumb = { ...breadcrumb };
  if (typeof out.message === "string") out.message = scrubString(out.message);
  if (!out.data) return out;
  if (out.category === "fetch" || out.category === "xhr") {
    const { method, status_code, url } = out.data;
    out.data = scrubData({ method, status_code, url });
    return out;
  }
  out.data = scrubData(out.data);
  return out;
}

/** `beforeSend`: the whole event, applied last so nothing added by integrations slips through. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const out: ErrorEvent = { ...event };

  if (out.request) {
    const { url, method } = out.request;
    out.request = {
      ...(url !== undefined ? { url: scrubUrl(url) } : {}),
      ...(method !== undefined ? { method } : {}),
    };
  }

  if (out.user) out.user = out.user.id !== undefined ? { id: out.user.id } : {};

  if (out.message !== undefined) out.message = scrubString(out.message);
  if (out.extra) out.extra = scrubValue(out.extra) as NonNullable<ErrorEvent["extra"]>;
  if (out.contexts) out.contexts = scrubValue(out.contexts) as NonNullable<ErrorEvent["contexts"]>;
  if (out.tags) out.tags = scrubValue(out.tags) as NonNullable<ErrorEvent["tags"]>;
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(scrubBreadcrumb);
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((item) =>
        typeof item.value === "string" ? { ...item, value: scrubString(item.value) } : item,
      ),
    };
  }
  return out;
}
