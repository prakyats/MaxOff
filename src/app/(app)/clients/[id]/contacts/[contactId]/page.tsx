import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { listDefinitions } from "@/core/custom-fields/server";
import { checkThenRead } from "@/core/lib/start-early";
import { PageHeader } from "@/core/ui/composites/page-header";
import { StatusBadge } from "@/core/ui/composites/status-badge";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { Skeleton } from "@/core/ui/primitives/skeleton";
import { getClientContact, getContactName, listContacts } from "@/modules/clients";
import { ContactMenu, ContactRecord } from "@/modules/clients/components/contact-record";

import { assertClientId, loadClient, loadPeople } from "../../client";

/**
 * The tab names the contact ("Asha Rao · MaxOff") from its name alone (`getContactName`, one
 * column under RLS, this client's only): Next resolves metadata on a prefetch too, which must
 * stay the loading boundary, never the page's reads (P2 item 6). One the reader may not see is
 * "Contact".
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; contactId: string }>;
}): Promise<Metadata> {
  const { id, contactId } = await params;
  return { title: (await getContactName(id, contactId)) ?? "Contact" };
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
  // v7.0: the contact alone (the read its tab title shares, `cache()`d), so the first wave reads
  // `client_contacts` once; the other contacts, which only the editor's ⋯ needs, stream in after.
  const [{ viewer, client, canEdit }, [contact, definitions, people]] = await checkThenRead(
    loadClient(id),
    Promise.all([
      getClientContact(id, contactId),
      listDefinitions("contact", { clientId: id }),
      loadPeople(),
    ]),
  );
  if (!contact) notFound();

  return (
    <>
      <PageHeader
        title={contact.name}
        description={client.name}
        back={{ href: `/clients/${client.id}`, label: client.name }}
        menu={
          canEdit ? (
            <Suspense fallback={<Skeleton aria-hidden className="size-11 rounded-lg" />}>
              <ContactMenuWithOthers
                clientId={client.id}
                contact={contact}
                canDelete={viewer.role === "owner"}
              />
            </Suspense>
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

/**
 * The contact's ⋯ with the client's other live contacts (the candidates to become primary), read
 * once the page has checked the client (v7.0): never in the first wave.
 */
async function ContactMenuWithOthers({
  clientId,
  contact,
  canDelete,
}: {
  clientId: string;
  contact: NonNullable<Awaited<ReturnType<typeof getClientContact>>>;
  canDelete: boolean;
}) {
  const others = (await listContacts(clientId))
    .filter((other) => other.id !== contact.id && other.archivedAt === null)
    .map((other) => ({ id: other.id, name: other.name }));
  return <ContactMenu contact={contact} others={others} canDelete={canDelete} />;
}
