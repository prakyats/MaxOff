"use client";

import { useState } from "react";

import { ArchivedRow, ArchivedSection } from "@/core/ui/composites/list-rows";
import { UnusedDeleteDialog } from "@/core/ui/composites/unused-delete-dialog";
import { toastResult } from "@/core/ui/toast";

import { contactUsage, deleteContact, restoreContact } from "../actions/clients";
import type { ClientContact } from "../domain/clients";

/**
 * A client's archived contacts at the foot of the Overview's Contacts (advisor audit, v1.8): the
 * shared collapsed "Archived (n)" every list with Archive has (`ArchivedSection`), never inline
 * among the live ones. Each row is the name, muted, over its designation, with Restore for whoever
 * edits the client (the Owner, its Admin) and the Owner's Delete (`canDelete`), whose confirmation
 * first asks whether anything ever pointed at the contact (V5a 6c, `UnusedDeleteDialog`).
 */
export function ArchivedContacts({
  contacts,
  canRestore,
  canDelete,
}: {
  contacts: readonly ClientContact[];
  canRestore: boolean;
  canDelete: boolean;
}) {
  const [deleting, setDeleting] = useState<ClientContact | null>(null);

  function restore(contact: ClientContact) {
    void restoreContact({ contactId: contact.id }).then((result) =>
      toastResult(result, { success: `${contact.name} restored` }),
    );
  }

  return (
    <>
      <ArchivedSection count={contacts.length}>
        {contacts.map((contact) => (
          <ArchivedRow
            key={contact.id}
            name={contact.name}
            meta={contact.designation ?? undefined}
            kind="Contact"
            onRestore={canRestore ? () => restore(contact) : undefined}
            onDelete={canDelete ? () => setDeleting(contact) : undefined}
          />
        ))}
      </ArchivedSection>
      {deleting ? (
        <UnusedDeleteDialog
          key={deleting.id}
          kind="contact"
          name={deleting.name}
          loadUsage={() => contactUsage({ contactId: deleting.id })}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={async () => {
            const { id, name } = deleting;
            toastResult(await deleteContact({ contactId: id }), { success: `${name} deleted` });
          }}
        />
      ) : null}
    </>
  );
}
