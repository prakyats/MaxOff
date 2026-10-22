import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";

import { listDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { PageHeader } from "@/core/ui/composites/page-header";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { listContacts } from "@/modules/clients";
import { ContactMenu, ContactRecord } from "@/modules/clients/components/contact-record";

import { assertClientId, loadClient, loadPeople } from "../../client";

/** The page's contacts read, shared with its tab title in one request. */
const readContacts = cache(listContacts);

/** The tab names the contact ("Asha Rao · MaxOff"), from the page's own reads (cached). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; contactId: string }>;
}): Promise<Metadata> {
  const { id, contactId } = await params;
  await loadClient(id);
  const contact = (await readContacts(id)).find((candidate) => candidate.id === contactId);
  return { title: contact?.name ?? "Contact" };
}

/**
 * One contact of a client (3.4): a drill-down from the Overview (back returns there, §14.2 b),
 * two taps from the Clients tab. Read-only first, Edit for the Owner and the client's Admin; the
 * ⋯ holds Make primary, Archive and Restore (kickoff 3 decision 4).
 */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ id: string; contactId: string }>;
}) {
  const { id, contactId } = await params;
  // Keyed by the client id in the URL: read together with the client (ARCHITECTURE §19).
  assertClientId(id);
  const [{ viewer, client, canEdit }, [contacts, definitions, people]] = await checkThenRead(
    loadClient(id),
    Promise.all([readContacts(id), listDefinitions("contact", { clientId: id }), loadPeople()]),
  );
  const contact = contacts.find((candidate) => candidate.id === contactId);
  if (!contact) notFound();
  const others = contacts
    .filter((other) => other.id !== contact.id && other.archivedAt === null)
    .map((other) => ({ id: other.id, name: other.name }));

  return (
    <>
      <PageHeader
        title={contact.name}
        description={client.name}
        back={{ href: `/clients/${client.id}`, label: client.name }}
        menu={
          canEdit ? (
            <ContactMenu contact={contact} others={others} canDelete={viewer.role === "owner"} />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4" data-slot="contact-page">
        {contact.archivedAt ? (
          <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge status="inactive" label="Archived" />
            <span className="text-muted-foreground">Restore it from ⋯ to edit it.</span>
          </p>
        ) : contact.isPrimary ? (
          <p className="text-sm">
            <StatusBadge status="active" label="Primary contact" />
          </p>
        ) : null}
        <Card>
          <CardContent>
            <ContactRecord
              contact={contact}
              definitions={definitions}
              members={people.options}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
