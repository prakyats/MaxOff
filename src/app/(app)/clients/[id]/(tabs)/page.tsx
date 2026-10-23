import {
  ChevronRightIcon,
  ExternalLinkIcon,
  FolderKanbanIcon,
  ListTodoIcon,
  PhoneIcon,
} from "lucide-react";
import type { Metadata } from "next";

import { listDefinitions } from "@/core/custom-fields/server";
import { cn } from "@/core/lib/utils";
import { checkThenRead, startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { todayIST } from "@/core/time";
import {
  CARD_ROW_MIN_H,
  CARD_ROW_PADDING,
  CARD_ROW_TITLE,
  CARD_ROW_TRAILING,
} from "@/core/ui/composites/row-metrics";
import { DrillLink } from "@/core/ui/composites/drill-link";
import { PersonAvatar } from "@/core/ui/composites/person-avatar";
import { StatusDot } from "@/core/ui/composites/status-badge";
import { Button } from "@/core/ui/primitives/button";
import { Card, CardContent } from "@/core/ui/primitives/card";
import {
  listClientProjects,
  listCurrentCycleMeters,
  projectSummaries,
  type ProjectSummary,
} from "@/modules/client-work";
import { getOwnerNotes, listContacts } from "@/modules/clients";
import { countOpenTasksForClient } from "@/modules/tasks";
import { AddContactDialog } from "@/modules/clients/components/add-contact-dialog";
import {
  ClientDetails,
  ClientNotes,
  OwnerNotes,
} from "@/modules/clients/components/client-details";
import { AddClientFieldButton } from "@/modules/settings/components/add-client-field-button";

import { assertClientId, loadClient, loadPeople } from "../client";
import { ProjectList } from "../project-list";

/**
 * The tab names the client ("Shetty · MaxOff") from `loadClient`, the layout's own read.
 * Next resolves metadata on a prefetch too; the layout's header makes this same `cache()`d read
 * on it (it always has), so the title adds no read to a prefetch (P2 item 6).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { client } = await loadClient((await params).id);
  return { title: client.name };
}

/**
 * A client's Overview (3.4, PRODUCT §4.4). **First glance** (PRODUCT §2; L6, UX review
 * 2026-10-21): the **active projects with their progress** first (for whoever runs client work:
 * the Owner, the client's Admin), then who runs it, whom to call (the primary contact, one tap to
 * phone) and the Drive folder, then the contacts, then the details, requirements and notes through
 * the edit pattern, each listing only what is filled in (the empty fields fold into "Add details"), and the Owner's private notes for
 * the Owner only (never read for an Admin, PERMISSIONS §2). A contact opens one tap deeper. The
 * client's tasks are one line, "N open tasks labelled ‹client›", opening All tasks filtered to it
 * (kickoff 7 decision 20: no tasks tab; copy says "tasks").
 */
export default async function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Everything is keyed by the client id in the URL, so it is read together with the client
  // and the session (ARCHITECTURE §19): RLS decides each read, `loadClient` still decides the
  // page (404 for a client this viewer may not see), and an Admin's owner notes are dropped.
  assertClientId(id);
  const notes = getOwnerNotes(id);
  startEarly(notes);
  const today = todayIST();
  const [{ viewer, client, canEdit }, [people, contacts, clientFields, contactFields, openTasks]] =
    await checkThenRead(
      loadClient(id),
      Promise.all([
        loadPeople(),
        listContacts(id),
        listDefinitions("client", { clientId: id }),
        listDefinitions("contact", { clientId: id }),
        countOpenTasksForClient(id),
      ]),
    );
  const [ownerNotes, active] = await Promise.all([
    can(viewer.role, "clients.private_notes") ? notes : Promise.resolve(null),
    can(viewer.role, "projects.manage") ? readActiveProjects(id, today) : Promise.resolve(null),
  ]);
  const live = contacts.filter((contact) => contact.archivedAt === null);
  const archived = contacts.filter((contact) => contact.archivedAt !== null);
  const primary = live.find((contact) => contact.isPrimary) ?? null;
  const adminName = client.adminId ? (people.names[client.adminId] ?? "An Admin") : null;
  const adminFace = client.adminId ? people.faces[client.adminId] : undefined;

  return (
    <div className="flex flex-col gap-4" data-slot="client-overview">
      {active ? <ActiveProjects clientId={client.id} projects={active} /> : null}
      {/* PP-client-3: "Key people", one compact two-column strip: who runs it and whom to call,
          with Call and the Drive folder under them. */}
      <section
        aria-labelledby="key-people"
        data-slot="client-glance"
        className="border-border bg-card shadow-raised flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm"
      >
        <h2 id="key-people" className="text-muted-foreground text-xs font-medium">
          Key people
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-0.5" data-slot="key-admin">
            <dt className="text-muted-foreground text-xs">Admin</dt>
            <dd
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                adminName ? "font-medium" : "text-muted-foreground",
              )}
            >
              {/* Their photo beside the name (#89); the name says who it is. */}
              {adminFace ? <PersonAvatar person={adminFace} size={20} /> : null}
              <span className="min-w-0 break-words">{adminName ?? "No Admin yet"}</span>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5" data-slot="key-contact">
            <dt className="text-muted-foreground text-xs">Primary contact</dt>
            {primary ? (
              <dd className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{primary.name}</span>
                {primary.designation ? (
                  <span className="text-muted-foreground text-xs break-words">
                    {primary.designation}
                  </span>
                ) : null}
              </dd>
            ) : (
              <dd className="text-muted-foreground">No contacts yet</dd>
            )}
          </div>
        </dl>
        {primary?.phone || client.driveUrl ? (
          <div className="flex flex-wrap gap-2">
            {primary?.phone ? (
              // A long name at large text wraps inside the button, never past the screen's edge.
              <Button
                variant="secondary"
                className="h-auto max-w-full py-1.5 text-left break-words whitespace-normal"
                asChild
              >
                <a href={`tel:${primary.phone.replace(/\s+/g, "")}`} data-slot="call-primary">
                  <PhoneIcon aria-hidden />
                  Call {primary.name}
                </a>
              </Button>
            ) : null}
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
        ) : null}
      </section>

      <ClientTasksLine clientId={client.id} clientName={client.name} count={openTasks} />

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
            className="border-border divide-border bg-card shadow-raised divide-y overflow-hidden rounded-lg border"
          >
            {[...live, ...archived].map((contact) => (
              <li key={contact.id}>
                <DrillLink
                  href={`/clients/${client.id}/contacts/${contact.id}`}
                  data-slot="contact-row"
                  className={cn(
                    "active:bg-muted/60 focus-visible:ring-ring flex flex-wrap items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-inset",
                    CARD_ROW_MIN_H,
                    CARD_ROW_PADDING,
                  )}
                >
                  {/* The DataTable card metrics: at large text the chip wraps under the name. */}
                  <span className={cn("flex flex-col gap-0.5", CARD_ROW_TITLE)}>
                    <span className="truncate text-sm font-medium">{contact.name}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {[contact.designation, contact.phone ?? contact.email]
                        .filter(Boolean)
                        .join(" · ") || "No details yet"}
                    </span>
                  </span>
                  <span className={cn("flex items-center gap-3", CARD_ROW_TRAILING)}>
                    {contact.archivedAt ? (
                      <StatusDot status="inactive" label="Archived" />
                    ) : contact.isPrimary ? (
                      <StatusDot status="active" label="Primary" />
                    ) : null}
                    <ChevronRightIcon
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                  </span>
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
            addField={
              // Whoever edits this client and defines fields (the Owner, its Admin) adds one
              // here; every client is the Owner's (PERMISSIONS ²). Settings manages them all.
              canEdit && can(viewer.role, "lists.manage") ? (
                <AddClientFieldButton
                  client={{ id: client.id, name: client.name }}
                  canGlobal={viewer.role === "owner"}
                />
              ) : undefined
            }
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

/**
 * "3 open tasks labelled Sharma Weddings" → All tasks filtered to the client (kickoff 7 decision
 * 20). With none it stays a quiet line of the same height, so the page never moves.
 */
function ClientTasksLine({
  clientId,
  clientName,
  count,
}: {
  clientId: string;
  clientName: string;
  count: number;
}) {
  const text =
    count === 0
      ? `No open tasks labelled ${clientName}`
      : `${count} open ${count === 1 ? "task" : "tasks"} labelled ${clientName}`;
  const inner = (
    <>
      <ListTodoIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{text}</span>
    </>
  );
  const box =
    "border-border bg-card flex min-h-11 items-center gap-3 rounded-lg border px-4 py-2 text-sm";
  return count === 0 ? (
    <p data-slot="client-tasks-line" className={cn(box, "text-muted-foreground")}>
      {inner}
    </p>
  ) : (
    <DrillLink
      href={`/tasks/all?client=${clientId}`}
      data-slot="client-tasks-line"
      className={cn(box, "font-medium")}
    >
      {inner}
      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
    </DrillLink>
  );
}

/** The client's working projects with their current cycle's progress (L6), oldest state first. */
async function readActiveProjects(clientId: string, today: string): Promise<ProjectSummary[]> {
  const [projects, current] = await Promise.all([
    listClientProjects(clientId),
    listCurrentCycleMeters(today, clientId),
  ]);
  return projectSummaries(projects, current, today).filter((summary) => !summary.finished);
}

/**
 * "Active projects" at the top of the Overview (L6): each working project's row as on the Projects
 * tab (its meter, percent and progress line), or one quiet line pointing to the Projects tab.
 */
function ActiveProjects({
  clientId,
  projects,
}: {
  clientId: string;
  projects: readonly ProjectSummary[];
}) {
  return (
    <section aria-labelledby="active-projects" className="flex flex-col gap-2">
      <h2 id="active-projects" className="flex min-h-11 items-center text-sm font-medium">
        Active projects
      </h2>
      {projects.length === 0 ? (
        <DrillLink
          href={`/clients/${clientId}/projects`}
          data-slot="client-no-projects"
          className="border-border bg-card text-muted-foreground flex min-h-11 items-center gap-3 rounded-lg border px-4 py-2 text-sm"
        >
          <FolderKanbanIcon className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">
            No active projects. Projects lists the finished ones and starts a new one.
          </span>
          <ChevronRightIcon className="size-4 shrink-0" aria-hidden />
        </DrillLink>
      ) : (
        <ProjectList clientId={clientId} projects={projects} label="Active projects" />
      )}
    </section>
  );
}
