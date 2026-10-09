import { formatIST, istDayStart } from "@/core/time";

/**
 * A project's history (7.3; PRODUCT §4.14, WORKFLOWS §5; amendment D): each audit entry about the
 * project, its default stages, its item list, its cycles, its items and their own stages as one
 * sentence, "Ravi marked Reel 2 done", "Prishit sent back Reel 2", "Ravi ticked Shoot on Reel 1". Pure, unit-tested. **Internal keys never show** (7A notes for 7B (a)): `overdue_armed_at`,
 * `delivery_armed_at`, `reopened_at`, `ready_armed_at` (and the bookkeeping `updated_at`,
 * `prompted_at`, `search`); an entry that changed only those says nothing. Entries that echo
 * another (an item's review row beside its "approved") are left out. Never an amount.
 *
 * **The database reads only what this describes** (the 7B rework's review, S7): the SQL
 * `app.client_work_activity_shown` (migration `client_work_rework_fixes`) lists the same entities,
 * actions and changed keys, so `project_activity`'s page of 20 is 20 lines and `item_last_changes`
 * is always a sentence. Change both together (the unit test lists them).
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

/** The item list's line: added, removed, renamed, moved, or its own stages set (amendment D2). */
function describeBlueprint(entry: ActivityEntry): string | null {
  if (entry.action === "update" && visibleChanges(entry).includes("stages")) {
    const title = text(entry.new.title) ?? text(entry.old.title);
    const names = Array.isArray(entry.new.stages)
      ? entry.new.stages.filter((name): name is string => typeof name === "string")
      : [];
    const what = title ? `the item list line ${title}` : "an item list line";
    return names.length > 0
      ? `set the stages of ${what}: ${names.join(", ")}`
      : `removed every stage of ${what}`;
  }
  return describeListRow(entry, "item list line", "title");
}

/** One of an item's own stages (amendment D2): added, renamed, moved, removed, ticked. */
function describeItemStage(entry: ActivityEntry, context: ProjectActivityContext): string | null {
  const title = context.items[entry.entityId] ?? "an item";
  const stage = text(entry.meta.name) ?? text(entry.new.name) ?? text(entry.old.name) ?? "a stage";
  switch (entry.action) {
    case "insert":
      return `added the stage ${text(entry.new.name) ?? stage} to ${title}`;
    case "archived":
      return `removed the stage ${stage} from ${title}`;
    case "ticked":
      return `ticked ${stage} on ${title}`;
    case "unticked":
      return `unticked ${stage} on ${title}`;
    case "update": {
      const keys = visibleChanges(entry);
      if (keys.includes("name")) {
        return `renamed the stage ${text(entry.old.name) ?? stage} to ${text(entry.new.name) ?? "a new name"} on ${title}`;
      }
      if (keys.includes("position")) return `moved the stage ${stage} on ${title}`;
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
    case "sent_back":
      return { text: `sent back ${title}`, ...(reason ? { note: reason } : {}) };
    case "reopened":
      return { text: `reopened ${title}`, ...(reason ? { note: reason } : {}) };
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
      // Amendment D2: the project's stages are the defaults new items start with.
      const sentence = describeListRow(entry, "default stage", "name");
      line = sentence ? { text: sentence } : null;
      break;
    }
    case "project_item_blueprints": {
      const sentence = describeBlueprint(entry);
      line = sentence ? { text: sentence } : null;
      break;
    }
    case "project_item_stage_list": {
      const sentence = describeItemStage(entry, context);
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

/** "Last change: ‹what› by ‹who›, ‹when›" in the item sheet (the owner's preview feedback). */
export function lastChangeOf(
  entry: ActivityEntry,
  context: ProjectActivityContext,
): { text: string; by: string; at: string } | null {
  const line = describeProjectActivity(entry, context);
  return line ? { text: line.text, by: line.actor, at: line.at } : null;
}

/** The activity panel's filter chips (view state, never history). */
export type ActivityKind = "all" | "items" | "stages" | "project";
export const ACTIVITY_KINDS: readonly { value: ActivityKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "items", label: "Items" },
  { value: "stages", label: "Stages" },
  { value: "project", label: "Project" },
];

/** A page of the panel: its lines and where the next page starts (null: the end). */
export type ActivityPage = {
  lines: ActivityLine[];
  next: { at: string; id: number } | null;
};
