/**
 * The Owner-only Delete of a template or a stage preset (v1.8 V5a item 6b, owner 2026-10-22;
 * DATA-MODEL §2 "The Owner-only Delete"): what its confirm says, in plain words for each kind,
 * and the "(deleted)" label anything made from a deleted template shows. Templates and presets
 * are copies, so nothing made from one changes; the database's `template_delete` does the work.
 */

/** The kinds `template_delete(kind, template_id)` takes. */
export type TemplateDeleteKind = "project" | "deliverable" | "task" | "stage_preset";

/** `template_usage`: the projects (or tasks) made from a template, and how many are still open. */
export type TemplateUsage = { used: number; open: number };

/** The name of a deleted template, wherever something made from it shows it. */
export function deletedTemplateLabel(name: string): string {
  return `${name} (deleted)`;
}

/** Kinds whose confirm needs the usage first (projects and tasks keep a link to them). */
export function deleteNeedsUsage(kind: TemplateDeleteKind): boolean {
  return kind === "project" || kind === "task";
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function openNote(usage: TemplateUsage): string {
  if (usage.open === 0) return "";
  if (usage.open === usage.used) return usage.used === 1 ? " (still open)" : " (all still open)";
  return ` (${usage.open} still open)`;
}

const FINAL = "This can't be undone.";

/**
 * The confirm's words (owner 2026-10-22: "Delete template 'Retainer 1'? Used by 3 projects (2 still
 * open). They keep all their deliverables, stages and months exactly as they are. Their details
 * will show 'Template: Retainer 1 (deleted)'. New projects can't use it any more. This can't be
 * undone."). Its red commit is named for the act ("Delete Retainer 1"); the way out is "Keep it".
 */
export function templateDeleteCopy(
  kind: TemplateDeleteKind,
  name: string,
  usage: TemplateUsage,
): { title: string; description: string; confirmLabel: string } {
  const title = kind === "stage_preset" ? `Delete preset “${name}”?` : `Delete template “${name}”?`;
  const confirmLabel = `Delete ${name}`;
  const one = usage.used === 1;
  let description: string;
  switch (kind) {
    case "project":
      description =
        usage.used === 0
          ? `No project was started from it. New projects can't use it any more. ${FINAL}`
          : [
              `Used by ${count(usage.used, "project", "projects")}${openNote(usage)}.`,
              one
                ? "It keeps all its deliverables, stages and months exactly as they are."
                : "They keep all their deliverables, stages and months exactly as they are.",
              `${one ? "Its" : "Their"} details will show “Template: ${deletedTemplateLabel(name)}”.`,
              "New projects can't use it any more.",
              FINAL,
            ].join(" ");
      break;
    case "task":
      description =
        usage.used === 0
          ? `No task was started from it. New tasks can't use it any more. ${FINAL}`
          : [
              `Used by ${count(usage.used, "task", "tasks")}${openNote(usage)}.`,
              one
                ? "It keeps everything exactly as it is."
                : "They keep everything exactly as it is.",
              usage.open === 0
                ? ""
                : usage.open === 1 && one
                  ? "Its reminders stay the same."
                  : "Open tasks keep the same reminders.",
              "New tasks can't use it any more.",
              FINAL,
            ]
              .filter(Boolean)
              .join(" ");
      break;
    case "deliverable":
      description = `Deliverables already added from it keep their stages exactly as they are. New deliverables can't use it any more. ${FINAL}`;
      break;
    case "stage_preset":
      description = `Stages already added from it stay exactly as they are. It won't be offered any more. ${FINAL}`;
      break;
  }
  return { title, description, confirmLabel };
}

/** `template_usage` / `template_delete`'s JSON, read safely (a missing count is 0). */
export function usageFromJson(value: unknown): TemplateUsage {
  const object =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const number = (key: string) => (typeof object[key] === "number" ? (object[key] as number) : 0);
  return { used: number("used"), open: number("open") };
}

/**
 * The Owner-only Delete of what was never used (v1.8 V5a item 6c, owner 2026-10-22: "any reference
 * counts as used"; DATA-MODEL §2): a task type, job title, expense category, custom field, draft
 * client or contact goes for good only when nothing has ever pointed at it (the database's
 * `unused_usage` / `unused_delete` decide). Everything else stays Archive-only.
 */
export type UnusedDeleteKind =
  "task_type" | "job_title" | "expense_category" | "field" | "client" | "contact";

/** `unused_usage`: whether anything has ever pointed at the row (nothing more is said). */
export type UnusedUsage = { used: boolean };

/** The plain reason a used row shows instead of Delete (owner 2026-10-22). */
export const IN_USE_REASON = "In use — archive it instead.";

const UNUSED_NOUN: Record<UnusedDeleteKind, string> = {
  task_type: "task type",
  job_title: "job title",
  expense_category: "category",
  field: "field",
  client: "client",
  contact: "contact",
};

/**
 * The confirm's words. While the check runs (`usage` null) the red commit waits; unused, it is the
 * named "Delete ‹name›" and the way out is "Keep it"; used, there is no commit at all, only the
 * reason and "Close".
 */
export function unusedDeleteCopy(
  kind: UnusedDeleteKind,
  name: string,
  usage: UnusedUsage | null,
): {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  canDelete: boolean;
} {
  const noun = UNUSED_NOUN[kind];
  const confirmLabel = `Delete ${name}`;
  const title = `Delete ${noun} “${name}”?`;
  if (usage === null) {
    return {
      title,
      description: "Checking whether anything has used it…",
      confirmLabel,
      cancelLabel: "Keep it",
      canDelete: false,
    };
  }
  if (!usage.used) {
    return {
      title,
      description:
        kind === "client"
          ? `Nothing else uses this draft (no contact, project, task, file or note), so it goes for good. ${FINAL}`
          : `Nothing has ever used it, so it goes for good. ${FINAL}`,
      confirmLabel,
      cancelLabel: "Keep it",
      canDelete: true,
    };
  }
  let description: string;
  switch (kind) {
    case "client":
      description =
        "In use — it stays. Only a draft that nothing else uses (no contact, project, task, file or note) can be deleted.";
      break;
    case "contact":
      description = `${IN_USE_REASON} Archived contacts stay in the history and can be restored.`;
      break;
    default:
      description = `${IN_USE_REASON} Archived, it keeps its place in the history and isn't offered any more.`;
  }
  return {
    title: `“${name}” is in use`,
    description,
    confirmLabel,
    cancelLabel: "Close",
    canDelete: false,
  };
}

/** `unused_usage`'s JSON, read safely: anything but an explicit `false` counts as used. */
export function unusedUsageFromJson(value: unknown): UnusedUsage {
  const object =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return { used: object.used !== false };
}
