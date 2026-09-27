"use server";

import { revalidatePath } from "next/cache";

import { action, AppError, isPostgresError, ok, type Result } from "@/core/errors";
import { assertPermission } from "@/core/permissions/server";

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

const CLIENTS_PATH = "/clients";

function clientPath(clientId: string): string {
  return `${CLIENTS_PATH}/${clientId}`;
}

function revalidateClient(clientId: string): void {
  revalidatePath(CLIENTS_PATH);
  revalidatePath(clientPath(clientId));
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

type ClientDetails = Omit<ReturnType<typeof updateClientSchema.parse>, "clientId">;

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

export const createClient = action(async (input: CreateClientInput): Promise<Result<Client>> => {
  const data = createClientSchema.parse(input);
  await assertPermission("clients.manage");
  try {
    const client = await repo.createClient({ ...detailsOf(data), admin_id: data.adminId });
    revalidatePath(CLIENTS_PATH);
    return ok(client);
  } catch (error) {
    nameTaken(error);
  }
});

export const updateClient = action(async (input: UpdateClientInput): Promise<Result<null>> => {
  const data = updateClientSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  try {
    await repo.updateClient(data.clientId, detailsOf(data));
  } catch (error) {
    nameTaken(error);
  }
  revalidateClient(data.clientId);
  return ok(null);
});

export const updateOwnerNotes = action(
  async (input: UpdateOwnerNotesInput): Promise<Result<null>> => {
    const data = updateOwnerNotesSchema.parse(input);
    await assertPermission("clients.private_notes");
    await repo.updateOwnerNotes(data.clientId, data.ownerNotes);
    revalidateClient(data.clientId);
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
  revalidateClient(clientId);
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
  revalidateClient(data.clientId);
  return ok(state);
});

export const assignClientAdmin = action(
  async (input: AssignClientAdminInput): Promise<Result<null>> => {
    const data = assignClientAdminSchema.parse(input);
    await assertPermission("clients.manage");
    await repo.assignClientAdmin(data.clientId, data.adminId);
    revalidateClient(data.clientId);
    return ok(null);
  },
);

export const createContact = action(
  async (input: CreateContactInput): Promise<Result<ClientContact>> => {
    const data = createContactSchema.parse(input);
    await assertPermission("clients.edit_assigned");
    const contact = await repo.createContact(data.clientId, {
      name: data.name,
      designation: data.designation,
      email: data.email,
      phone: data.phone,
      custom_fields: data.customFields,
    });
    revalidateClient(data.clientId);
    return ok(contact);
  },
);

export const updateContact = action(async (input: UpdateContactInput): Promise<Result<null>> => {
  const data = updateContactSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.updateContact(data.contactId, {
    name: data.name,
    designation: data.designation,
    email: data.email,
    phone: data.phone,
    custom_fields: data.customFields,
  });
  revalidatePath(CLIENTS_PATH);
  return ok(null);
});

export const setPrimaryContact = action(async (input: ContactIdInput): Promise<Result<null>> => {
  const { contactId } = contactIdSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.setPrimaryContact(contactId);
  revalidatePath(CLIENTS_PATH);
  return ok(null);
});

export const archiveContact = action(async (input: ArchiveContactInput): Promise<Result<null>> => {
  const data = archiveContactSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.archiveContact(data.contactId, data.nextPrimaryId);
  revalidatePath(CLIENTS_PATH);
  return ok(null);
});

export const restoreContact = action(async (input: ContactIdInput): Promise<Result<null>> => {
  const { contactId } = contactIdSchema.parse(input);
  await assertPermission("clients.edit_assigned");
  await repo.restoreContact(contactId);
  revalidatePath(CLIENTS_PATH);
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
  revalidateClient(data.clientId);
  return ok(null);
});
