import { notFound } from "next/navigation";
import { cache } from "react";

import { startEarly } from "@/core/lib/start-early";
import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { getClient } from "@/modules/clients";
import { listDirectory } from "@/modules/team";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A 404 for anything that is not a client id, before a page starts reads keyed by it: the id goes
 * into PostgREST filters (`listDefinitions`' `or=`), so it is validated first (ARCHITECTURE §19).
 */
export function assertClientId(id: string): void {
  if (!ID.test(id)) notFound();
}

/**
 * A client's page (3.4): the Owner (`clients.manage`) and the client's Admin
 * (`clients.edit_assigned` on an assigned client, RLS decides). Staff never reach it (the
 * permission redirects to /forbidden); an unknown client, or another Admin's, is a 404. Cached
 * per request: the layout, the menu and the view all ask. The client row is read together with
 * the session (ARCHITECTURE §19); RLS decides whether it comes back, the permission check still
 * comes first.
 */
export const loadClient = cache(async (id: string) => {
  assertClientId(id);
  const read = getClient(id);
  startEarly(read);
  const viewer = await requirePermission(["clients.manage", "clients.edit_assigned"]);
  const client = await read;
  if (!client) notFound();
  return {
    viewer,
    client,
    canManage: can(viewer.role, "clients.manage"),
    canEdit: can(viewer.role, "clients.edit_assigned"),
  };
});

/**
 * A client's work screens (7.3: the Projects tab and a project's page): the client as
 * `loadClient` reads it, and `projects.manage` (the Owner, the client's Admin; PERMISSIONS
 * "Screens (phase 7)"). Cached per request.
 */
export const loadClientWork = cache(async (id: string) => {
  const loaded = await loadClient(id);
  const viewer = await requirePermission("projects.manage");
  return { ...loaded, viewer };
});

/**
 * The people a client screen names: every member's name (an actor in the history, a client's
 * Admin, a `member` custom field), and the active Admins the Owner may assign. Names, roles and
 * statuses only, so everyone reads the directory (PERMISSIONS §2: no email is needed here), and
 * the read does not wait for the viewer's role: a client screen starts it with the session read
 * (ARCHITECTURE §19).
 */
export const loadPeople = cache(async () => {
  const members = await listDirectory();
  const names = Object.fromEntries(members.map((member) => [member.id, member.fullName]));
  const admins = members
    .filter((member) => member.role === "admin" && member.status === "active")
    .map((member) => ({ id: member.id, name: member.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const options = members
    .filter((member) => member.status === "active")
    .map((member) => ({ id: member.id, name: member.fullName }));
  // The Owner's id: his send-back of a done item reads "Sent back", an Admin's "Reopened" (D3).
  const ownerId = members.find((member) => member.role === "owner")?.id ?? null;
  return { names, admins, options, ownerId };
});
