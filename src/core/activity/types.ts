/** One audit entry as a screen reads it: the diff split into `old` and `new`. */
export type ActivityEntry = {
  id: number;
  /** The member who acted (their auth id); `null` for the system (a job, a trigger). */
  actorId: string | null;
  /**
   * The freelancer the actor acted for (ADR-0013, 4A: `activity_log.on_behalf_of_id`): a
   * coordinator's "Noted by Ravi for Asha". Null when the actor acted for themselves.
   */
  onBehalfOfId: string | null;
  entity: string;
  entityId: string;
  action: string;
  old: Record<string, unknown>;
  new: Record<string, unknown>;
  meta: Record<string, unknown>;
  at: string;
};

/** The entries about these rows of one table (`entity` is the table name). */
export type ActivityTarget = { entity: string; ids: readonly string[] };

/** How many entries a record's Activity view reads: the latest, newest first. */
export const ACTIVITY_LIMIT = 50;
