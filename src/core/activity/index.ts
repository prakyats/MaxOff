/**
 * core/activity: reading the audit trail (`activity_log`, DATA-MODEL §9) for a record's
 * Activity view (3.4 is the first). The log is written only by `app.audit_row_change()` and the
 * transition functions; this area only reads, under RLS, so each module's policy decides which
 * entries a viewer gets (PERMISSIONS §2). The reader is `@/core/activity/server` (`server-only`);
 * this barrel is client-safe.
 */
export type { ActivityEntry, ActivityTarget } from "./types";
export { ACTIVITY_LIMIT } from "./types";
