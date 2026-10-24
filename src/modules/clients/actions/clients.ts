"use server";

import { z } from "zod";

import { revalidateScreens } from "@/core/lib/revalidate-screens";
import { validateCustomFieldsFor } from "@/core/custom-fields/server";
import { action, AppError, isPostgresError, ok, type Result } from "@/core/errors";
import { dispatchPushSoon } from "@/core/notifications/push/dispatch";
import type { UnusedUsage } from "@/core/lib/owner-delete";
import { assertOwner, assertPermission } from "@/core/permissions/server";

import type { Client, ClientContact, ClientState } from "../domain/clients";
import {
  type ArchiveContactInput,
  archiveContactSchema,
  type AssignClientAdminInput,
  assignClientAdminSchema,
  type ClientIdInput,
  clientIdSchema,
  type CloseClientInput,
  closeClientSchema,
  type ContactIdInput,
  contactIdSchema,
  type CreateClientInput,
  createClientSchema,
  type CreateContactInput,
  createContactSchema,
  type SetClientLogoInput,
  setClientLogoSchema,
  type UpdateBrandInput,
  updateBrandSchema,
  type UpdateClientInput,
  updateClientSchema,
  type UpdateContactInput,
  updateContactSchema,
  type UpdateOwnerNotesInput,
  updateOwnerNotesSchema,
} from "../domain/schemas";
import * as repo from "../data/clients";

/**
 * Client actions (ARCHITECTURE §4.2): zod → `assertPermission()` → repository → revalidate →
 * `Result`. Details, contacts, brand and the Owner's notes are plain edits (the audit trigger
 * records them); the lifecycle and the Admin assignment go through the transition functions
 * (ADR-0006). Custom field values are validated against the definitions by `core/custom-fields`
 * before the write (3.2).
 */

/**
 * The list, every client screen (overview, brand, activity, a contact) and the client labels on
 * tasks and Today read the same rows, so a change revalidates every screen (3.4, 6b.17a).
 */
function revalidateClients(): void {
  revalidateScreens();
}

/** unique (org_id, lower(name)) where state <> 'inactive': the generic message says nothing about the name. */
function nameTaken(error: unknown): never {
  if (isPostgresError(error) && error.code === "23505") {
    throw new AppError("CONFLICT", "Another client already uses this name.", {
      fieldErrors: { name: ["Another client already uses this name."] },
    });
  }
  throw error;
}

type ClientDetails = Omit<ReturnType<typeof createClientSchema.parse>, "adminId">;

function detailsOf(data: ClientDetails): repo.ClientDetailsPatch {
  return {
    name: data.name,
    legal_name: data.legalName,
    gstin: data.gstin,
    address: data.address,
    city: data.city,
    phone: data.phone,
    email: data.email,
    website: data.website,
    drive_url: data.driveUrl,
    requirements: data.requirements,
    notes: data.notes,
    custom_fields: data.customFields,
  };
}

const CLIENT_COLUMNS = {
  name: "name",
  legalName: "legal_name",
  gstin: "gstin",
  address: "address",
  city: "city",
  phone: "phone",
  email: "email",
  website: "website",
  driveUrl: "drive_url",
  requirements: "requirements",
  notes: "notes",
} as const satisfies Partial<Record<keyof UpdateClientInput, keyof repo.ClientDetailsPatch>>;

/** The columns of the keys the caller sent, with their parsed values. */
function clientPatchOf(
  input: UpdateClientInput,
  data: ReturnType<typeof updateClientSchema.parse>,
): Partial<repo.ClientDetailsPatch> {
  const patch: Partial<Record<keyof repo.ClientDetailsPatch, unknown>> = {};
  for (const [key, column] of Object.entries(CLIENT_COLUMNS) as [
    keyof typeof CLIENT_COLUMNS,
    keyof repo.ClientDetailsPatch,
  ][]) {
    if (key in input) patch[column] = data[key];
  }
  return patch as Partial<repo.ClientDetailsPatch>;
}

export const createClient = action(async (input: CreateClientInput): Promise<Result<Client>> => {
  const data = createClientSchema.parse(input);
  await assertPermission("clients.manage");
  const customFields = await validateCustomFieldsFor("client", data.customFields);
  try {
    const client = await repo.createClient({
      ...detailsOf({ ...data, customFields }),
      admin_id: data.adminId,
    });
    revalidateClients();
    return ok(client);
  } catch (error) {
    nameTaken(error);
  }
});

/**
 * "New client" for an Admin (`clients.create` without `clients.manage`; kickoff 7 amendment B): no
 * Admin to pick, the client is theirs and starts Active (`client_create`). The Owner's stays a
 * Draft (`createClient`).
 */
export const createOwnClient = action(
  async (input: CreateClientInput): Promise<Result<{ id: string }>> => {
    const data = createClientSchema.parse(input);
    await assertPermission("clients.create");
    const customFields = await validateCustomFieldsFor("client", data.customFields);
    const id = await repo.createOwnClient(detailsOf({ ...data, customFields }));
    revalidateClients();
    dispatchPushSoon();
    return ok({ id });
  },
);

export const updateClient = action(async (input: UpdateClientInput): Promise<Result<null>> => {
  const data = updateClientSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  const current = await repo.getClient(data.clientId);
  if (!current) throw new AppError("NOT_FOUND", "This client is not one of yours.");
  // Only what the saving record sent (3.4 review): the Overview has two records, and one must
  // never write back the other's values as they were when the page loaded.
  const patch = clientPatchOf(input, data);
  if (data.customFields !== undefined) {
    patch.custom_fields = await validateCustomFieldsFor("client", data.customFields, {
      clientId: data.clientId,
      previous: current.customFields,
    });
  }
  try {
    await repo.updateClient(data.clientId, patch);
  } catch (error) {
    nameTaken(error);
  }
  revalidateClients();
  return ok(null);
});

export const updateOwnerNotes = action(
  async (input: UpdateOwnerNotesInput): Promise<Result<null>> => {
    const data = updateOwnerNotesSchema.parse(input);
    await assertPermission("clients.private_notes");
    await repo.updateOwnerNotes(data.clientId, data.ownerNotes);
    revalidateClients();
    return ok(null);
  },
);

async function lifecycle(
  input: ClientIdInput,
  move: (clientId: string) => Promise<ClientState>,
): Promise<Result<ClientState>> {
  const { clientId } = clientIdSchema.parse(input);
  await assertPermission("clients.manage");
  const state = await move(clientId);
  revalidateClients();
  return ok(state);
}

export const activateClient = action(async (input: ClientIdInput) =>
  lifecycle(input, repo.activateClient),
);

export const pauseClient = action(async (input: ClientIdInput) =>
  lifecycle(input, repo.pauseClient),
);

export const reactivateClient = action(async (input: ClientIdInput) =>
  lifecycle(input, repo.reactivateClient),
);

export const closeClient = action(async (input: CloseClientInput): Promise<Result<ClientState>> => {
  const data = closeClientSchema.parse(input);
  await assertPermission("clients.manage");
  const state = await repo.closeClient(data.clientId, data.reason);
  revalidateClients();
  return ok(state);
});

export const assignClientAdmin = action(
  async (input: AssignClientAdminInput): Promise<Result<null>> => {
    const data = assignClientAdminSchema.parse(input);
    await assertPermission("clients.manage");
    await repo.assignClientAdmin(data.clientId, data.adminId);
    revalidateClients();
    return ok(null);
  },
);

export const createContact = action(
  async (input: CreateContactInput): Promise<Result<ClientContact>> => {
    const data = createContactSchema.parse(input);
    await assertPermission("clients.edit_assigned");
    const customFields = await validateCustomFieldsFor("contact", data.customFields, {
      clientId: data.clientId,
    });
    const contact = await repo.createContact(data.clientId, {
      name: data.name,
      designation: data.designation,
      email: data.email,
      phone: data.phone,
      custom_fields: customFields,
    });
    revalidateClients();
    return ok(contact);
  },
);

export const updateContact = action(async (input: UpdateContactInput): Promise<Result<null>> => {
  const data = updateContactSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  const current = await repo.getContact(data.contactId);
  if (!current) throw new AppError("NOT_FOUND", "This contact does not exist.");
  const customFields = await validateCustomFieldsFor("contact", data.customFields, {
    clientId: current.clientId,
    previous: current.customFields,
  });
  await repo.updateContact(data.contactId, {
    name: data.name,
    designation: data.designation,
    email: data.email,
    phone: data.phone,
    custom_fields: customFields,
  });
  revalidateClients();
  return ok(null);
});

export const setPrimaryContact = action(async (input: ContactIdInput): Promise<Result<null>> => {
  const { contactId } = contactIdSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.setPrimaryContact(contactId);
  revalidateClients();
  return ok(null);
});

export const archiveContact = action(async (input: ArchiveContactInput): Promise<Result<null>> => {
  const data = archiveContactSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.archiveContact(data.contactId, data.nextPrimaryId);
  revalidateClients();
  return ok(null);
});

export const restoreContact = action(async (input: ContactIdInput): Promise<Result<null>> => {
  const { contactId } = contactIdSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.restoreContact(contactId);
  revalidateClients();
  return ok(null);
});

export const updateBrand = action(async (input: UpdateBrandInput): Promise<Result<null>> => {
  const data = updateBrandSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.updateBrand(data.clientId, {
    colors: data.colors,
    fonts: data.fonts,
    tone_of_voice: data.toneOfVoice,
    brand_notes: data.brandNotes,
  });
  revalidateClients();
  return ok(null);
});

/**
 * The client's logo (3.3 mechanics, 3.4 screen): a plain column update. The guard trigger
 * requires a ready original image the caller uploaded, and the replaced file is archived (its
 * object deleted 30 days later by `storage_cleanup`).
 */
export const setClientLogo = action(async (input: SetClientLogoInput): Promise<Result<null>> => {
  const data = setClientLogoSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.setLogo(data.clientId, data.fileId);
  revalidateClients();
  return ok(null);
});

export const removeClientLogo = action(async (input: ClientIdInput): Promise<Result<null>> => {
  const { clientId } = clientIdSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.setLogo(clientId, null);
  revalidateClients();
  return ok(null);
});

const clientIdOnlySchema = z.object({ clientId: z.uuid() });
export type ClientIdOnlyInput = z.input<typeof clientIdOnlySchema>;
const contactIdOnlySchema = z.object({ contactId: z.uuid() });
export type ContactIdOnlyInput = z.input<typeof contactIdOnlySchema>;

/**
 * The Owner-only Delete of a draft client or a contact nothing has ever pointed at (v1.8 V5a 6c,
 * owner 2026-10-22): the confirm reads the usage first; the database checks again with the row
 * locked and refuses anything in use.
 */
export const draftClientUsage = action(
  async (input: ClientIdOnlyInput): Promise<Result<UnusedUsage>> => {
    const { clientId } = clientIdOnlySchema.parse(input);
    await assertOwner();
    return ok(await repo.unusedUsage("client", clientId));
  },
);

export const deleteDraftClient = action(async (input: ClientIdOnlyInput): Promise<Result<null>> => {
  const { clientId } = clientIdOnlySchema.parse(input);
  await assertOwner();
  await repo.deleteUnused("client", clientId);
  revalidateClients();
  return ok(null);
});

export const contactUsage = action(
  async (input: ContactIdOnlyInput): Promise<Result<UnusedUsage>> => {
    const { contactId } = contactIdOnlySchema.parse(input);
    await assertOwner();
    return ok(await repo.unusedUsage("contact", contactId));
  },
);

export const deleteContact = action(async (input: ContactIdOnlyInput): Promise<Result<null>> => {
  const { contactId } = contactIdOnlySchema.parse(input);
  await assertOwner();
  await repo.deleteUnused("contact", contactId);
  revalidateClients();
  return ok(null);
});
