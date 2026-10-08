import { formatIST, istDayStart } from "@/core/time";

/**
 * A project's history (7.3; PRODUCT §4.14, WORKFLOWS §5): each audit entry about the project, its
 * stages, its item list, its cycles and the cycle's items as one sentence, "Ravi marked Reel 2
 * done". Pure, unit-tested. **Internal keys never show** (7A notes for 7B (a)): `overdue_armed_at`,
 * `delivery_armed_at`, `reopened_at`, `ready_armed_at` (and the bookkeeping `updated_at`,
 * `prompted_at`, `search`); an entry that changed only those says nothing. Entries that echo
 * another (an item's review row beside its "approved") are left out. Never an amount.
 */

/** An audit entry as `core/activity` reads it (structurally its `ActivityEntry`; ADR-0011). */
export type ActivityEntry = {
  id: number;
  actorId: string | null;
  entity: string;
  entityId: string;
  action: string;
  old: Record<string, unknown>;
  new: Record<string, unknown>;
  meta: Record<string, unknown>;
  at: string;
};

export type ActivityLine = { id: number; at: string; actor: string; text: string; note?: string };

export type ProjectActivityContext = {
  names: Readonly<Record<string, string>>;
  /** Item titles by id (the cycle's items). */
  items: Readonly<Record<string, string>>;
  /** Stage names by id, removed ones included. */
  stages: Readonly<Record<string, string>>;
  /**
   * Project names by id, for a history that spans projects (the client's Activity): "created the
   * project Monthly reels". Without it, "the project" (the project's own page).
   */
  projects?: Readonly<Record<string, string>>;
};

/** Columns the history never names: internal timers and bookkeeping. */
export const INTERNAL_KEYS: ReadonlySet<string> = new Set([
  "overdue_armed_at",
  "delivery_armed_at",
  "reopened_at",
  "ready_armed_at",
  "prompted_at",
  "updated_at",
  "search",
]);

const PROJECT_FIELDS: Record<string, string> = {
  name: "name",
  description: "description",
  custom_fields: "fields",
};

const ITEM_FIELDS: Record<string, string> = {
  title: "title",
  notes: "notes",
  planned_date: "planned date",
  custom_fields: "fields",
  position: "place in the list",
};

function joinNouns(nouns: readonly string[]): string {
  if (nouns.length <= 1) return nouns[0] ?? "";
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The changed keys a sentence may name (internal ones dropped). */
export function visibleChanges(entry: Pick<ActivityEntry, "new">): string[] {
  return Object.keys(entry.new).filter((key) => !INTERNAL_KEYS.has(key));
}

function date(value: unknown): string | null {
  const day = text(value);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatIST(istDayStart(day), "d MMM") : null;
}

function describeProject(
  entry: ActivityEntry,
  context: ProjectActivityContext,
): { text: string; note?: string } | null {
  const named = context.projects?.[entry.entityId];
  const project = named ? `the project ${named}` : "the project";
  switch (entry.action) {
    case "insert":
      return { text: `created ${project}` };
    case "started":
      return { text: `started work on ${project}` };
    case "completed":
      return { text: `completed ${project}` };
    case "cancelled": {
      const reason = text(entry.new.cancelled_reason);
      return { text: `cancelled ${project}`, ...(reason ? { note: reason } : {}) };
    }
    case "reopened": {
      const reason = text(entry.meta.reason);
      return { text: `reopened ${project}`, ...(reason ? { note: reason } : {}) };
    }
    case "update": {
      const keys = visibleChanges(entry);
      const lines: string[] = [];
      if (keys.includes("delivery_date")) {
        const to = date(entry.new.delivery_date);
        const of = named ? ` of ${named}` : "";
        lines.push(to ? `moved the delivery date${of} to ${to}` : `changed the delivery date${of}`);
      }
      const nouns = keys.flatMap((key) => (PROJECT_FIELDS[key] ? [PROJECT_FIELDS[key]] : []));
      if (nouns.length > 0) lines.push(`changed ${named ?? "the project"}'s ${joinNouns(nouns)}`);
      return lines.length > 0 ? { text: lines.join(" and ") } : null;
    }
    default:
      return null;
  }
}

function describeListRow(
  entry: ActivityEntry,
  label: string,
  nameKey: "name" | "title",
): string | null {
  const name = text(entry.new[nameKey]) ?? text(entry.old[nameKey]) ?? `a ${label}`;
  switch (entry.action) {
    case "insert":
      return `added the ${label} ${name}`;
    case "archived":
      return `removed the ${label} ${text(entry.old[nameKey]) ?? name}`;
    case "update": {
      const keys = visibleChanges(entry);
      if (keys.includes(nameKey)) {
        return `renamed the ${label} ${text(entry.old[nameKey]) ?? "a row"} to ${name}`;
      }
      if (keys.includes("position")) return `moved the ${label} ${name}`;
      return null;
    }
    default:
      return null;
  }
}

function describeCycle(entry: ActivityEntry): string | null {
  const label = text(entry.new.label) ?? text(entry.old.label);
  switch (entry.action) {
    case "generated":
    case "insert":
      return label ? `started ${label}` : "started the project's cycle";
    case "item_list_added":
      return label ? `added the item list to ${label}` : "added the item list";
    default:
      return null;
  }
}

function describeItem(
  entry: ActivityEntry,
  context: ProjectActivityContext,
): { text: string; note?: string } | null {
  const title =
    context.items[entry.entityId] ?? text(entry.new.title) ?? text(entry.old.title) ?? "an item";
  const reason = text(entry.meta.reason) ?? text(entry.new.cancelled_reason);
  switch (entry.action) {
    case "insert":
      return { text: `added ${title}` };
    case "done":
      return { text: `marked ${title} done` };
    case "not_done":
      return { text: `marked ${title} not done` };
    case "approved":
      return { text: `approved ${title}` };
    case "rejected":
      return { text: `sent back ${title}`, ...(reason ? { note: reason } : {}) };
    case "cancelled":
    case "closed":
      return { text: `closed ${title}`, ...(reason ? { note: reason } : {}) };
    case "carried":
      return { text: `carried ${title} forward` };
    case "carried_in":
      return { text: `carried ${title} into this cycle` };
    case "left_pending":
      return { text: `left ${title} pending` };
    case "update": {
      const nouns = visibleChanges(entry).flatMap((key) =>
        ITEM_FIELDS[key] ? [ITEM_FIELDS[key]] : [],
      );
      if (nouns.length === 0) return null;
      if (nouns.length === 1 && nouns[0] === "planned date") {
        const to = date(entry.new.planned_date);
        return { text: to ? `planned ${title} for ${to}` : `cleared ${title}'s planned date` };
      }
      return { text: `changed ${title}'s ${joinNouns(nouns)}` };
    }
    default:
      return null;
  }
}

function describeTick(entry: ActivityEntry, context: ProjectActivityContext): string | null {
  const title = context.items[entry.entityId] ?? "an item";
  const stageId = text(entry.meta.stage_id) ?? text(entry.new.stage_id);
  const stage = stageId ? (context.stages[stageId] ?? "a stage") : "a stage";
  if (entry.action === "ticked") return `ticked ${stage} on ${title}`;
  if (entry.action === "unticked") return `unticked ${stage} on ${title}`;
  return null;
}

export function describeProjectActivity(
  entry: ActivityEntry,
  context: ProjectActivityContext,
): ActivityLine | null {
  let line: { text: string; note?: string } | null = null;
  switch (entry.entity) {
    case "projects":
      line = describeProject(entry, context);
      break;
    case "project_stages": {
      const sentence = describeListRow(entry, "stage", "name");
      line = sentence ? { text: sentence } : null;
      break;
    }
    case "project_item_blueprints": {
      const sentence = describeListRow(entry, "item list line", "title");
      line = sentence ? { text: sentence } : null;
      break;
    }
    case "project_cycles": {
      const sentence = describeCycle(entry);
      line = sentence ? { text: sentence } : null;
      break;
    }
    case "project_items":
      line = describeItem(entry, context);
      break;
    case "project_item_stages": {
      const sentence = describeTick(entry, context);
      line = sentence ? { text: sentence } : null;
      break;
    }
    default:
      line = null;
  }
  if (!line) return null;
  const actor = entry.actorId ? (context.names[entry.actorId] ?? "Someone") : "MaxOff";
  return {
    id: entry.id,
    at: entry.at,
    actor,
    text: line.text,
    ...(line.note ? { note: line.note } : {}),
  };
}
