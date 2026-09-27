"use client";

import { customFieldsExtra } from "@/core/custom-fields/components/custom-fields-extra";
import type { MemberOption } from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import { EditableRecord, type EditableField } from "@/core/ui/composites/editable-record";

import { updateClient, updateOwnerNotes } from "../actions/clients";
import { type Client, clientEditKey } from "../domain/clients";
import {
  CLIENT_ADDRESS_MAX,
  CLIENT_CITY_MAX,
  CLIENT_LEGAL_NAME_MAX,
  CLIENT_NAME_MAX,
  CLIENT_OWNER_NOTES_MAX,
  CLIENT_PHONE_MAX,
  CLIENT_TEXT_MAX,
  CLIENT_URL_MAX,
} from "../domain/limits";

type DetailField =
  "name" | "legalName" | "gstin" | "phone" | "email" | "website" | "driveUrl" | "address" | "city";

type NotesField = "requirements" | "notes";

/**
 * A client's details (3.4, PRODUCT §4.4) through the edit pattern: read-only first, Edit for
 * the Owner and the client's Admin (`clients.edit_assigned`), or from the header's ⋯ (Edit
 * details). The client's custom fields are part of the same record, so a required one is checked
 * when this form is saved (WORKFLOWS §4a). Paused and Inactive clients stay editable (kickoff 3).
 */
export function ClientDetails({
  client,
  definitions,
  members,
  canEdit,
}: {
  client: Client;
  definitions: readonly FieldDefinition[];
  members: readonly MemberOption[];
  canEdit: boolean;
}) {
  const fields: EditableField<DetailField>[] = [
    {
      name: "name",
      label: "Name",
      noun: "name",
      value: client.name,
      input: { maxLength: CLIENT_NAME_MAX, required: true, autoComplete: "off" },
    },
    {
      name: "legalName",
      label: "Legal or business name",
      noun: "legal name",
      value: client.legalName,
      input: { maxLength: CLIENT_LEGAL_NAME_MAX, autoComplete: "off" },
    },
    {
      name: "gstin",
      label: "GSTIN",
      noun: "GSTIN",
      value: client.gstin,
      hint: "15 characters, e.g. 29ABCDE1234F1Z5.",
      input: { maxLength: 15, autoComplete: "off" },
    },
    {
      name: "phone",
      label: "Phone",
      noun: "phone",
      value: client.phone,
      display: "tel",
      input: { type: "tel", inputMode: "tel", maxLength: CLIENT_PHONE_MAX, autoComplete: "off" },
    },
    {
      name: "email",
      label: "Email",
      noun: "email",
      value: client.email,
      display: "email",
      input: { type: "email", inputMode: "email", maxLength: 254, autoComplete: "off" },
    },
    {
      name: "website",
      label: "Website",
      noun: "website",
      value: client.website,
      display: "link",
      input: {
        type: "url",
        inputMode: "url",
        maxLength: CLIENT_URL_MAX,
        placeholder: "https://",
      },
    },
    {
      name: "driveUrl",
      label: "Google Drive folder",
      noun: "Drive link",
      value: client.driveUrl,
      display: "link",
      hint: "The client's asset folder, a full https:// link.",
      input: {
        type: "url",
        inputMode: "url",
        maxLength: CLIENT_URL_MAX,
        placeholder: "https://drive.google.com/…",
      },
    },
    {
      name: "address",
      label: "Address",
      noun: "address",
      value: client.address,
      kind: "textarea",
      display: "multiline",
      rows: 3,
      input: { maxLength: CLIENT_ADDRESS_MAX },
    },
    {
      name: "city",
      label: "City",
      noun: "city",
      value: client.city,
      input: { maxLength: CLIENT_CITY_MAX, autoComplete: "off" },
    },
  ];

  return (
    <EditableRecord<DetailField, Record<string, unknown>>
      title="Details"
      subject={client.name}
      fields={fields}
      extra={
        customFieldsExtra({
          definitions,
          values: client.customFields,
          subject: client.name,
          members,
        }) ?? {
          value: client.customFields,
          changes: () => [],
          edit: () => null,
          read: () => null,
        }
      }
      canEdit={canEdit}
      editKey={clientEditKey(client.id)}
      savedMessage="Details saved"
      onSave={(values, customFields) =>
        updateClient({ clientId: client.id, ...values, customFields })
      }
    />
  );
}

/** Requirements and notes: long text, their own record so the details stay short (3.4). */
export function ClientNotes({ client, canEdit }: { client: Client; canEdit: boolean }) {
  const fields: EditableField<NotesField>[] = [
    {
      name: "requirements",
      label: "Requirements",
      noun: "requirements",
      value: client.requirements,
      kind: "textarea",
      display: "multiline",
      rows: 4,
      input: { maxLength: CLIENT_TEXT_MAX },
    },
    {
      name: "notes",
      label: "Notes",
      noun: "notes",
      value: client.notes,
      kind: "textarea",
      display: "multiline",
      rows: 4,
      input: { maxLength: CLIENT_TEXT_MAX },
    },
  ];
  return (
    <EditableRecord<NotesField>
      title="Requirements and notes"
      subject={client.name}
      fields={fields}
      canEdit={canEdit}
      savedMessage="Saved"
      onSave={(values) => updateClient({ clientId: client.id, ...values })}
    />
  );
}

/**
 * The Owner's private notes (`client_private`, `clients.private_notes`): never in an Admin's
 * payload, since the page reads them only for the Owner (PERMISSIONS §2).
 */
export function OwnerNotes({ client, notes }: { client: Client; notes: string | null }) {
  return (
    <EditableRecord<"ownerNotes">
      title="Owner's notes"
      subject={client.name}
      fields={[
        {
          name: "ownerNotes",
          label: "Only you see these",
          noun: "Owner's notes",
          value: notes,
          kind: "textarea",
          display: "multiline",
          rows: 4,
          emptyLabel: "No notes yet",
          input: { maxLength: CLIENT_OWNER_NOTES_MAX },
        },
      ]}
      savedMessage="Notes saved"
      onSave={(values) => updateOwnerNotes({ clientId: client.id, ownerNotes: values.ownerNotes })}
    />
  );
}
