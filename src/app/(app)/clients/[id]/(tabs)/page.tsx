import { ChevronRightIcon, ExternalLinkIcon, PhoneIcon } from "lucide-react";
import type { Metadata } from "next";

import { listDefinitions } from "@/core/custom-fields/server";
import { can } from "@/core/permissions";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { Card, CardContent } from "@/core/ui/primitives/card";
import { getOwnerNotes, listContacts } from "@/modules/clients";
import { AddContactDialog } from "@/modules/clients/components/add-contact-dialog";
import {
  ClientDetails,
  ClientNotes,
  OwnerNotes,
} from "@/modules/clients/components/client-details";

import { loadClient, loadPeople } from "../client";

export const metadata: Metadata = { title: "Client" };

/**
 * A client's Overview (3.4, PRODUCT §4.4). **First glance** (PRODUCT §2): who runs it, whom to
 * call (the primary contact, one tap to phone) and the Drive folder, then the contacts, then the
 * details, requirements and notes through the edit pattern, and the Owner's private notes for
 * the Owner only (never read for an Admin, PERMISSIONS §2). A contact opens one tap deeper.
 */
export default async function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { viewer, client, canManage, canEdit } = await loadClient(id);
  const [people, contacts, clientFields, contactFields, ownerNotes] = await Promise.all([
    loadPeople(canManage),
    listContacts(client.id),
    listDefinitions("client", { clientId: client.id }),
    listDefinitions("contact", { clientId: client.id }),
    can(viewer.role, "clients.private_notes") ? getOwnerNotes(client.id) : Promise.resolve(null),
  ]);
  const live = contacts.filter((contact) => contact.archivedAt === null);
  const archived = contacts.filter((contact) => contact.archivedAt !== null);
  const primary = live.find((contact) => contact.isPrimary) ?? null;
  const adminName = client.adminId ? (people.names[client.adminId] ?? "An Admin") : null;

  return (
    <div className="flex max-w-2xl flex-col gap-4" data-slot="client-overview">
      <Card>
        <CardContent className="flex flex-col gap-3 text-sm" data-slot="client-glance">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-muted-foreground">Admin</p>
              <p className="font-medium">
                {adminName ?? <span className="text-muted-foreground">No Admin yet</span>}
              </p>
            </div>
            {client.driveUrl ? (
              <Button variant="secondary" asChild>
                <a
                  href={client.driveUrl}
                  target="_blank"
                  rel="noreferrer"
                  data-slot="drive-link"
                  aria-label="Drive folder (opens in a new tab)"
                >
                  <ExternalLinkIcon aria-hidden />
                  Drive folder
                </a>
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-muted-foreground">Primary contact</p>
              {primary ? (
                <>
                  <p className="truncate font-medium">{primary.name}</p>
                  {primary.designation ? (
                    <p className="text-muted-foreground truncate">{primary.designation}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">No contacts yet</p>
              )}
            </div>
            {primary?.phone ? (
              <Button variant="secondary" asChild>
                <a href={`tel:${primary.phone.replace(/\s+/g, "")}`} data-slot="call-primary">
                  <PhoneIcon aria-hidden />
                  Call
                </a>
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="contacts-title" className="flex flex-col gap-2">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
          <h2 id="contacts-title" className="text-sm font-medium">
            Contacts
          </h2>
          {canEdit ? (
            <AddContactDialog
              clientId={client.id}
              clientName={client.name}
              definitions={contactFields}
              members={people.options}
            />
          ) : null}
        </div>
        {contacts.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            No contacts yet. The first one added becomes the primary contact.
          </p>
        ) : (
          <ul
            data-slot="contact-list"
            aria-label="Contacts"
            className="border-border divide-border bg-card divide-y overflow-hidden rounded-lg border"
          >
            {[...live, ...archived].map((contact) => (
              <li key={contact.id}>
                <DrillLink
                  href={`/clients/${client.id}/contacts/${contact.id}`}
                  data-slot="contact-row"
                  className="active:bg-muted/60 focus-visible:ring-ring flex min-h-14 items-center gap-3 px-4 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{contact.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {[contact.designation, contact.phone ?? contact.email]
                        .filter(Boolean)
                        .join(" · ") || "No details yet"}
                    </span>
                  </span>
                  {contact.archivedAt ? (
                    <StatusDot status="inactive" label="Archived" />
                  ) : contact.isPrimary ? (
                    <StatusDot status="active" label="Primary" />
                  ) : null}
                  <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                </DrillLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <CardContent>
          <ClientDetails
            client={client}
            definitions={clientFields}
            members={people.options}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <ClientNotes client={client} canEdit={canEdit} />
        </CardContent>
      </Card>
      {can(viewer.role, "clients.private_notes") ? (
        <Card>
          <CardContent>
            <OwnerNotes client={client} notes={ownerNotes} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
