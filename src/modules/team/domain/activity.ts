import { ROLE_LABELS } from "@/core/lib/role-labels";

/** An audit entry as `core/activity` reads it: what this needs of `ActivityEntry`. */
type ActivityEntry = {
  id: number;
  actorId: string | null;
  action: string;
  new: Record<string, unknown>;
  at: string;
};

/** One line of a person's History (PP-person-1): who did what, and when. */
export type MemberHistoryLine = { id: number; at: string; actor: string; text: string };

/** The member row's columns a person reads in their History, in plain words. */
const FIELD_WORDS: Readonly<Record<string, string>> = {
  full_name: "the name",
  role: "the role",
  job_title_id: "the job title",
  phone: "the phone number",
  email: "the sign-in email",
  avatar_file_id: "the photo",
  engagement: "the engagement",
};

const STATUS_WORDS: Readonly<Record<string, string>> = {
  active: "Active",
  invited: "Invited",
  deactivated: "Deactivated",
};

function roleWord(value: unknown): string | null {
  return typeof value === "string" && value in ROLE_LABELS
    ? ROLE_LABELS[value as keyof typeof ROLE_LABELS]
    : null;
}

/** "the name, role and job title". */
function listWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * One entry about a member row (`activity_log`, entity `members`, read under RLS: the Owner's
 * `activity.view_all`) in one sentence, or null when it says nothing a reader needs (a sign-in's
 * bookkeeping). The reader's own changes say "You" (v1.8 pull-in item 5), as every other History.
 * Pure (`tests/activity.test.ts`).
 */
export function describeMemberActivity(
  entry: ActivityEntry,
  names: Readonly<Record<string, string>>,
  readerId: string | null = null,
): MemberHistoryLine | null {
  const actor =
    entry.actorId === null
      ? "MaxOff"
      : entry.actorId === readerId
        ? "You"
        : (names[entry.actorId] ?? "Someone");
  const line = (text: string) => ({ id: entry.id, at: entry.at, actor, text });
  switch (entry.action) {
    case "invited":
      return line("invited them");
    case "invited_as_employee":
      return line("invited them as an employee");
    case "freelancer_added":
      return line("added them as a freelancer");
    case "invite_link_issued":
      return line("made an invite link");
    case "accepted":
      return line("accepted the invite");
    case "first_login":
      return line("signed in for the first time");
    case "insert":
      return line("added them");
    case "deactivated":
      return line("deactivated them");
    case "reactivated":
      return line("reactivated them");
    case "update": {
      const changed = Object.keys(entry.new);
      if (changed.includes("status")) {
        const to = STATUS_WORDS[String(entry.new.status)];
        if (to) return line(`set the status to ${to}`);
      }
      const role = roleWord(entry.new.role);
      const words = changed.flatMap((key) => (FIELD_WORDS[key] ? [FIELD_WORDS[key]] : []));
      if (words.length === 0) return null;
      if (role && words.length === 1) return line(`changed the role to ${role}`);
      return line(`changed ${listWords(words)}`);
    }
    default:
      return null;
  }
}
