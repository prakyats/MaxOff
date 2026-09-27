import { notFound } from "next/navigation";
import { cache } from "react";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { getClient } from "@/modules/clients";
import { listDirectory, listMembers } from "@/modules/team";

const ID = /^[0-9a-f-]{36}$/i;

/**
 * A client's page (3.4): the Owner (`clients.manage`) and the client's Admin
 * (`clients.edit_assigned` on an assigned client, RLS decides). Staff never reach it (the
 * permission redirects to /forbidden); an unknown client, or another Admin's, is a 404. Cached
 * per request: the layout, the menu and the view all ask.
 */
export const loadClient = cache(async (id: string) => {
  const viewer = await requirePermission(["clients.manage", "clients.edit_assigned"]);
  if (!ID.test(id)) notFound();
  const client = await getClient(id);
  if (!client) notFound();
  return {
    viewer,
    client,
    canManage: can(viewer.role, "clients.manage"),
    canEdit: can(viewer.role, "clients.edit_assigned"),
  };
});

/**
 * The people a client screen names: every member's name (an actor in the history, a client's
 * Admin, a `member` custom field), and the active Admins the Owner may assign. The Owner reads
 * the members table, an Admin the directory (PERMISSIONS §2).
 */
export const loadPeople = cache(async (canManage: boolean) => {
  const members = canManage ? await listMembers() : await listDirectory();
  const names = Object.fromEntries(members.map((member) => [member.id, member.fullName]));
  const admins = members
    .filter((member) => member.role === "admin" && member.status === "active")
    .map((member) => ({ id: member.id, name: member.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const options = members
    .filter((member) => member.status === "active")
    .map((member) => ({ id: member.id, name: member.fullName }));
  return { names, admins, options };
});
