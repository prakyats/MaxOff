/**
 * A client's Activity view (3.4, PRODUCT §4.4): each audit entry about the client, its brand,
 * its contacts and the Owner's notes as one sentence, "Prishit Shetty paused the client". Pure,
 * so the wording is unit-tested. Entries that only echo another one (the brand and notes rows the
 * client's creation makes, an assignment row beside "made Ravi the Admin", the primary flag
 * leaving the previous contact) are left out.
 */

/** An audit entry as `core/activity` reads it (structurally its `ActivityEntry`; ADR-0011 keeps
 * the domain free of other core areas). */
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

export type ActivityLine = {
  id: number;
  at: string;
  actor: string;
  text: string;
  /** A second line: the Owner's close reason (shown to the Owner only). */
  note?: string;
};

export type ActivityContext = {
  /** Member names by id, for the actor and an assigned Admin. */
  names: Readonly<Record<string, string>>;
  /** Contact names by id, archived ones included. */
  contacts: Readonly<Record<string, string>>;
  /** The close reason is the Owner's (Owner-only in the database too, phase 3 review). */
  showCloseReason: boolean;
};

const CLIENT_FIELDS: Record<string, string> = {
  name: "name",
  legal_name: "legal name",
  gstin: "GSTIN",
  address: "address",
  city: "city",
  phone: "phone",
  email: "email",
  website: "website",
  drive_url: "Drive link",
  requirements: "requirements",
  notes: "notes",
  custom_fields: "custom fields",
};

const BRAND_FIELDS: Record<string, string> = {
  colors: "colours",
  fonts: "fonts",
  tone_of_voice: "tone of voice",
  brand_notes: "brand notes",
};

const CONTACT_FIELDS: Record<string, string> = {
  name: "name",
  designation: "designation",
  email: "email",
  phone: "phone",
  custom_fields: "custom fields",
};

/** "a", "a and b", "a, b and c". */
export function joinNouns(nouns: readonly string[]): string {
  if (nouns.length <= 1) return nouns[0] ?? "";
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

function changed(entry: ActivityEntry, nouns: Record<string, string>): string[] {
  return Object.keys(entry.new)
    .map((key) => nouns[key])
    .filter((noun): noun is string => noun !== undefined);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function describeClient(entry: ActivityEntry, context: ActivityContext): string | null {
  switch (entry.action) {
    case "insert":
      return "created the client";
    case "activated":
      return "activated the client";
    case "paused":
      return "paused the client";
    case "closed":
      return "closed the client";
    case "reactivated":
      return "reactivated the client";
    case "admin_assigned": {
      const to = context.names[String(entry.meta.to_admin_id)] ?? "someone";
      const fromId = entry.meta.from_admin_id;
      const from = typeof fromId === "string" ? (context.names[fromId] ?? "someone") : null;
      return from ? `moved the client from ${from} to ${to}` : `made ${to} the Admin`;
    }
    case "update": {
      const nouns = changed(entry, CLIENT_FIELDS);
      return nouns.length > 0 ? `changed the ${joinNouns(nouns)}` : null;
    }
    default:
      return null;
  }
}

function describeBrand(entry: ActivityEntry): string | null {
  if (entry.action !== "update") return null;
  const lines: string[] = [];
  if ("logo_file_id" in entry.new) {
    if (entry.new.logo_file_id === null) lines.push("removed the logo");
    else if (entry.old.logo_file_id === null) lines.push("added the logo");
    else lines.push("replaced the logo");
  }
  const nouns = changed(entry, BRAND_FIELDS);
  if (nouns.length > 0) lines.push(`changed the brand ${joinNouns(nouns)}`);
  return lines.length > 0 ? lines.join(" and ") : null;
}

function describeContact(entry: ActivityEntry, context: ActivityContext): string | null {
  const name = context.contacts[entry.entityId] ?? text(entry.new.name) ?? "a contact";
  switch (entry.action) {
    case "insert":
      return `added the contact ${name}`;
    case "update": {
      const nouns = changed(entry, CONTACT_FIELDS);
      return nouns.length > 0 ? `changed ${name}'s ${joinNouns(nouns)}` : null;
    }
    case "primary_set":
      return `made ${name} the primary contact`;
    case "archived":
      return `archived the contact ${name}`;
    case "restored":
      return `restored the contact ${name}`;
    default:
      return null;
  }
}

export function describeClientActivity(
  entry: ActivityEntry,
  context: ActivityContext,
): ActivityLine | null {
  let sentence: string | null;
  switch (entry.entity) {
    case "clients":
      sentence = describeClient(entry, context);
      break;
    case "client_brand":
      sentence = describeBrand(entry);
      break;
    case "client_contacts":
      sentence = describeContact(entry, context);
      break;
    case "client_private":
      sentence = entry.action === "update" ? "changed the Owner's notes" : null;
      break;
    default:
      sentence = null;
  }
  if (!sentence) return null;
  const actor = entry.actorId ? (context.names[entry.actorId] ?? "Someone") : "MaxOff";
  const reason =
    entry.entity === "clients" && entry.action === "closed" && context.showCloseReason
      ? text(entry.meta.reason)
      : null;
  return {
    id: entry.id,
    at: entry.at,
    actor,
    text: sentence,
    ...(reason ? { note: reason } : {}),
  };
}
