"use client";

import { MoreHorizontalIcon } from "lucide-react";
import { useId, useState } from "react";

import { customFieldsExtra } from "@/core/custom-fields/components/custom-fields-extra";
import type { MemberOption } from "@/core/custom-fields/components/custom-fields-form";
import type { FieldDefinition } from "@/core/custom-fields";
import { ConfirmDialog } from "@/core/ui/composites/confirm-dialog";
import { EditableRecord, type EditableField } from "@/core/ui/composites/editable-record";
import { ErrorText } from "@/core/ui/composites/error-text";
import { requestEdit } from "@/core/ui/edit/edit-requests";
import { Button } from "@/core/ui/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/ui/primitives/dropdown-menu";
import { Label } from "@/core/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/core/ui/primitives/select";
import { toastResult } from "@/core/ui/toast";

import {
  archiveContact,
  restoreContact,
  setPrimaryContact,
  updateContact,
} from "../actions/clients";
import type { ClientContact } from "../domain/clients";
import { CLIENT_PHONE_MAX, CONTACT_DESIGNATION_MAX, CONTACT_NAME_MAX } from "../domain/limits";

type Field = "name" | "designation" | "email" | "phone";

export function contactEditKey(contactId: string): string {
  return `contact:${contactId}`;
}

/**
 * One contact through the edit pattern (3.4): name, designation, email and phone (tap to mail
 * or call) and the contact custom fields, read-only first. An archived contact is read-only until
 * it is restored.
 */
export function ContactRecord({
  contact,
  definitions,
  members,
  canEdit,
}: {
  contact: ClientContact;
  definitions: readonly FieldDefinition[];
  members: readonly MemberOption[];
  canEdit: boolean;
}) {
  const fields: EditableField<Field>[] = [
    {
      name: "name",
      label: "Name",
      noun: "name",
      value: contact.name,
      input: { maxLength: CONTACT_NAME_MAX, required: true, autoComplete: "off" },
    },
    {
      name: "designation",
      label: "Designation",
      noun: "designation",
      value: contact.designation,
      input: { maxLength: CONTACT_DESIGNATION_MAX, autoComplete: "off" },
    },
    {
      name: "email",
      label: "Email",
      noun: "email",
      value: contact.email,
      display: "email",
      input: { type: "email", inputMode: "email", maxLength: 254, autoComplete: "off" },
    },
    {
      name: "phone",
      label: "Phone",
      noun: "phone",
      value: contact.phone,
      display: "tel",
      input: { type: "tel", inputMode: "tel", maxLength: CLIENT_PHONE_MAX, autoComplete: "off" },
    },
  ];
  const extra = customFieldsExtra({
    definitions,
    values: contact.customFields,
    subject: contact.name,
    members,
  });

  return (
    <EditableRecord<Field, Record<string, unknown>>
      title="Contact"
      subject={contact.name}
      fields={fields}
      {...(extra ? { extra } : {})}
      canEdit={canEdit && contact.archivedAt === null}
      editKey={contactEditKey(contact.id)}
      savedMessage="Contact saved"
      onSave={(values, customFields) =>
        updateContact({
          contactId: contact.id,
          ...values,
          customFields: customFields ?? contact.customFields,
        })
      }
    />
  );
}

/**
 * The contact's ⋯ (3.4, kickoff 3 decision 4): Edit, Make primary, Archive (the primary asks
 * which live contact takes over; exactly one primary stays while any live contact exists) and
 * Restore. The moves go through their functions (`client_contact_*`), audited there.
 */
export function ContactMenu({
  contact,
  others,
}: {
  contact: ClientContact;
  /** The client's other live contacts, the candidates to become primary. */
  others: readonly { id: string; name: string }[];
}) {
  const [dialog, setDialog] = useState<"archive" | "primary" | null>(null);
  const [nextId, setNextId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const selectId = useId();
  const archived = contact.archivedAt !== null;
  const needsNext = contact.isPrimary && others.length > 0;
  const next = others.find((other) => other.id === nextId);

  function restore() {
    void restoreContact({ contactId: contact.id }).then((result) =>
      toastResult(result, { success: `${contact.name} is restored` }),
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${contact.name}`}
            className="size-11 md:size-8"
          >
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {archived ? (
            <DropdownMenuItem onSelect={restore}>Restore</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => requestEdit(contactEditKey(contact.id))}>
                Edit
              </DropdownMenuItem>
              {contact.isPrimary ? null : (
                <DropdownMenuItem onSelect={() => setDialog("primary")}>
                  Make primary
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("archive")}>
                Archive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={dialog === "primary"}
        onOpenChange={(open) => setDialog(open ? "primary" : null)}
        title={`Make ${contact.name} the primary contact?`}
        description="The primary contact is the one the team reaches first."
        confirmLabel={`Make ${contact.name} primary`}
        onConfirm={async () => {
          const result = await setPrimaryContact({ contactId: contact.id });
          toastResult(result, { success: `${contact.name} is the primary contact` });
        }}
      />

      <ConfirmDialog
        open={dialog === "archive"}
        onOpenChange={(open) => {
          setDialog(open ? "archive" : null);
          if (!open) {
            setNextId("");
            setProblem(null);
          }
        }}
        title={`Archive ${contact.name}?`}
        description={
          needsNext
            ? "They are the primary contact, so choose who takes over. Archived contacts stay in the history and can be restored."
            : "Archived contacts stay in the history and can be restored."
        }
        confirmLabel={`Archive ${contact.name}`}
        onConfirm={async () => {
          if (needsNext && !next) {
            setProblem("Choose the next primary contact.");
            return false;
          }
          const result = await archiveContact({
            contactId: contact.id,
            nextPrimaryId: next?.id ?? "",
          });
          toastResult(result, { success: `${contact.name} is archived` });
        }}
      >
        {needsNext ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={selectId}>Next primary contact</Label>
            <Select
              value={nextId}
              onValueChange={(value) => {
                setNextId(value);
                setProblem(null);
              }}
            >
              <SelectTrigger
                id={selectId}
                className="w-full"
                aria-invalid={problem ? true : undefined}
              >
                <SelectValue placeholder="Choose a contact" />
              </SelectTrigger>
              <SelectContent>
                {others.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {other.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {problem ? <ErrorText>{problem}</ErrorText> : null}
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
