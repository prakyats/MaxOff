/**
 * The deep-link entry (ARCHITECTURE §14.2 h, task 5.2): a push tap, the bell or the history
 * screen (5A step 4) opens a record **with its parent list underneath**, so back goes to the
 * list, never out of the app. `/open?to=<path>` lays the parent entry down, then the detail.
 *
 * The parent of a path is the path one segment up (`/tasks/<id>` → `/tasks`, `/leave/expenses`
 * → `/leave`, `/settings/templates` → `/settings`); a top-level screen (`/approvals`,
 * `/notifications`) sits on the role's home. Query strings and hashes stay with the target.
 */
export const OPEN_PATH = "/open";

/** A path this app may open: absolute, no scheme or host, never `/open` itself. */
export function isInAppPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/api/") &&
    value !== OPEN_PATH &&
    !value.startsWith(`${OPEN_PATH}?`) &&
    !/[\s\\]/.test(value) &&
    value.length <= 500
  );
}

export function parentOf(path: string, home: string): string {
  const pathname = path.split(/[?#]/)[0] ?? "/";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return home;
  return `/${segments.slice(0, -1).join("/")}`;
}

/** The URL a notification's link opens through: `/open?to=/tasks/<id>`. */
export function openUrl(path: string): string {
  return `${OPEN_PATH}?to=${encodeURIComponent(path)}`;
}

/**
 * The URL a notification opens through when tapped in the bell's history: `/open?n=<id>`. The
 * entry marks that notification read and opens its own link (the row's, never the address's),
 * so one tap is one request, and the link works before the page has hydrated.
 */
export function openNotificationUrl(id: string): string {
  return `${OPEN_PATH}?n=${encodeURIComponent(id)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A notification id the entry may mark read: a uuid, nothing else. */
export function isNotificationId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
