import "server-only";

import { type ActivityEntry } from "@/core/activity";
import { listActivity } from "@/core/activity/server";
import type { Json, Tables } from "@/core/db";
import { createServerSupabase } from "@/core/db/server";
import { AppError } from "@/core/errors";

import {
  type Client,
  type ClientAdminAssignment,
  type ClientBrand,
  type ClientContact,
  type ClientLabel,
  type ClientState,
  type ClientSummary,
} from "../domain/clients";
import { parseBrandColors, parseBrandFonts } from "../domain/schemas";

/**
 * The clients repository: every database call of the module (CLAUDE.md rule 3). Reads run
 * under RLS as the signed-in member, so the Owner sees every client and an Admin only theirs
 * (PERMISSIONS §2); Staff get nothing, and `client_private` answers only the Owner.
 */

type ClientRow = Tables<"clients">;

function toClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    state: row.state,
    adminId: row.admin_id,
    gstin: row.gstin,
    address: row.address,
    city: row.city,
    phone: row.phone,
    email: row.email,
    website: row.website,
    driveUrl: row.drive_url,
    requirements: row.requirements,
    notes: row.notes,
    customFields: asObject(row.custom_fields),
    activatedAt: row.activated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Custom field values are plain JSON (validated by core/custom-fields); the column is typed `Json`. */
function toJson(value: Record<string, unknown>): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toContact(row: Tables<"client_contacts">): ClientContact {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    designation: row.designation,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary,
    customFields: asObject(row.custom_fields),
    archivedAt: row.archived_at,
  };
}

function toBrand(row: Tables<"client_brand">): ClientBrand {
  return {
    clientId: row.client_id,
    logoFileId: row.logo_file_id,
    colors: parseBrandColors(row.colors),
    fonts: parseBrandFonts(row.fonts),
    toneOfVoice: row.tone_of_voice,
    brandNotes: row.brand_notes,
  };
}

/** A write RLS refuses matches no row; `count` turns that silence into a refusal. */
function refusedWhenNone(count: number | null, message: string): void {
  if (count === 0) throw new AppError("NOT_FOUND", message);
}

const NOT_YOURS = "This client is not one of yours.";

export type ClientDetailsPatch = {
  name: string;
  legal_name: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  drive_url: string | null;
  requirements: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown>;
};

export async function listClients(
  options: { states?: readonly ClientState[] } = {},
): Promise<Client[]> {
  const supabase = await createServerSupabase();
  let query = supabase.from("clients").select("*").order("name", { ascending: true });
  if (options.states && options.states.length > 0) query = query.in("state", [...options.states]);
  const { data, error } = await query;
  if (error) throw error;
  return data.map(toClient);
}

/**
 * The list screen's rows (3.4): every client the viewer may see (RLS: the Owner all, an Admin
 * theirs) with the logo the list shows. Filtering by state and Admin is the screen's view control.
 */
export async function listClientSummaries(): Promise<ClientSummary[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("*, client_brand(logo_file_id)")
    .order("name", { ascending: true });
  if (error) throw error;
  return data.map((row) => {
    const { client_brand: brand, ...client } = row;
    const first = Array.isArray(brand) ? brand[0] : brand;
    return { ...toClient(client), logoFileId: first?.logo_file_id ?? null };
  });
}

export async function getClient(clientId: string): Promise<Client | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data ? toClient(data) : null;
}

/** Plain INSERT under `clients.manage`; the triggers add the private, brand and assignment rows. */
export async function createClient(
  values: ClientDetailsPatch & { admin_id: string | null },
): Promise<Client> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("clients")
    .insert({ ...values, custom_fields: toJson(values.custom_fields) })
    .select("*")
    .single();
  if (error) throw error;
  return toClient(data);
}

export async function updateClient(
  clientId: string,
  patch: Partial<ClientDetailsPatch>,
): Promise<void> {
  const { custom_fields: customFields, ...columns } = patch;
  const values = {
    ...columns,
    ...(customFields !== undefined ? { custom_fields: toJson(customFields) } : {}),
  };
  if (Object.keys(values).length === 0) return;
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("clients")
    .update(values, { count: "exact" })
    .eq("id", clientId);
  if (error) throw error;
  refusedWhenNone(count, NOT_YOURS);
}

export async function getOwnerNotes(clientId: string): Promise<string | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("client_private")
    .select("owner_notes")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data?.owner_notes ?? null;
}

export async function updateOwnerNotes(clientId: string, ownerNotes: string | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("client_private")
    .update({ owner_notes: ownerNotes }, { count: "exact" })
    .eq("client_id", clientId);
  if (error) throw error;
  refusedWhenNone(count, "Only the Owner keeps these notes.");
}

export async function listContacts(clientId: string): Promise<ClientContact[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("client_contacts")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map(toContact);
}

export async function getContact(contactId: string): Promise<ClientContact | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("client_contacts")
    .select("*")
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw error;
  return data ? toContact(data) : null;
}

export type ContactPatch = {
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  custom_fields: Record<string, unknown>;
};

export async function createContact(
  clientId: string,
  values: ContactPatch,
): Promise<ClientContact> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("client_contacts")
    .insert({ client_id: clientId, ...values, custom_fields: toJson(values.custom_fields) })
    .select("*")
    .single();
  if (error) throw error;
  return toContact(data);
}

export async function updateContact(contactId: string, patch: ContactPatch): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("client_contacts")
    .update({ ...patch, custom_fields: toJson(patch.custom_fields) }, { count: "exact" })
    .eq("id", contactId);
  if (error) throw error;
  refusedWhenNone(count, "This contact does not exist.");
}

export async function getBrand(clientId: string): Promise<ClientBrand | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("client_brand")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data ? toBrand(data) : null;
}

export async function updateBrand(
  clientId: string,
  patch: {
    colors: ClientBrand["colors"];
    fonts: ClientBrand["fonts"];
    tone_of_voice: string | null;
    brand_notes: string | null;
  },
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("client_brand")
    .update(patch, { count: "exact" })
    .eq("client_id", clientId);
  if (error) throw error;
  refusedWhenNone(count, NOT_YOURS);
}

/** The logo (3.3's guard and archive triggers do the checking and the clean-up). */
export async function setLogo(clientId: string, logoFileId: string | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { error, count } = await supabase
    .from("client_brand")
    .update({ logo_file_id: logoFileId }, { count: "exact" })
    .eq("client_id", clientId);
  if (error) throw error;
  refusedWhenNone(count, NOT_YOURS);
}

/**
 * A client's audit trail (3.4): the client row, its brand, its contacts and, for the Owner, its
 * private notes and close reasons (RLS answers the rest: an Admin never reads `client_private`
 * entries or `client_close_reasons`, so a closed entry reaches them without its reason).
 */
export async function listClientActivity(
  clientId: string,
  contactIds: readonly string[],
): Promise<ActivityEntry[]> {
  const entries = await listActivity([
    { entity: "clients", ids: [clientId] },
    { entity: "client_brand", ids: [clientId] },
    { entity: "client_private", ids: [clientId] },
    { entity: "client_contacts", ids: contactIds },
  ]);
  const closed = entries.filter((entry) => entry.entity === "clients" && entry.action === "closed");
  if (closed.length === 0) return entries;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("client_close_reasons")
    .select("activity_id, reason")
    .in(
      "activity_id",
      closed.map((entry) => entry.id),
    );
  if (error) throw error;
  const reasons = new Map(data.map((row) => [row.activity_id, row.reason]));
  return entries.map((entry) => {
    const reason = reasons.get(entry.id);
    return reason === undefined ? entry : { ...entry, meta: { ...entry.meta, reason } };
  });
}

export async function listAdminAssignments(clientId: string): Promise<ClientAdminAssignment[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("client_admin_assignments")
    .select("id, admin_id, assigned_by, from_at, to_at")
    .eq("client_id", clientId)
    .order("from_at", { ascending: false });
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    adminId: row.admin_id,
    assignedBy: row.assigned_by,
    fromAt: row.from_at,
    toAt: row.to_at,
  }));
}

/** The label rows the caller may see (`client_labels`, PERMISSIONS §2). */
export async function listClientLabels(): Promise<ClientLabel[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("client_labels").select("*").order("name");
  if (error) throw error;
  return data.map((row) => {
    // A security-definer view's columns are typed nullable; the base tables' are not.
    if (!row.id || !row.name || !row.state) {
      throw new AppError("INTERNAL", undefined, {
        cause: new Error("client_labels row incomplete"),
      });
    }
    return {
      id: row.id,
      name: row.name,
      state: row.state,
      logoFileId: row.logo_file_id,
      colors: parseBrandColors(row.colors),
      fonts: parseBrandFonts(row.fonts),
      toneOfVoice: row.tone_of_voice,
      brandNotes: row.brand_notes,
    };
  });
}

// Transition functions (ADR-0006): permission, scope, state, write and audit in one transaction.

export async function activateClient(clientId: string): Promise<ClientState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("client_activate", { client_id: clientId });
  if (error) throw error;
  return data;
}

export async function pauseClient(clientId: string): Promise<ClientState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("client_pause", { client_id: clientId });
  if (error) throw error;
  return data;
}

export async function closeClient(clientId: string, reason: string | null): Promise<ClientState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("client_close", {
    client_id: clientId,
    ...(reason ? { reason } : {}),
  });
  if (error) throw error;
  return data;
}

export async function reactivateClient(clientId: string): Promise<ClientState> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("client_reactivate", { client_id: clientId });
  if (error) throw error;
  return data;
}

export async function assignClientAdmin(clientId: string, adminId: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("client_assign_admin", {
    client_id: clientId,
    admin_id: adminId,
  });
  if (error) throw error;
  return data;
}

export async function setPrimaryContact(contactId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("client_contact_set_primary", { contact_id: contactId });
  if (error) throw error;
}

export async function archiveContact(
  contactId: string,
  nextPrimaryId: string | null,
): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("client_contact_archive", {
    contact_id: contactId,
    ...(nextPrimaryId ? { next_primary_id: nextPrimaryId } : {}),
  });
  if (error) throw error;
}

export async function restoreContact(contactId: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("client_contact_restore", { contact_id: contactId });
  if (error) throw error;
}
