import "server-only";

import { z } from "zod";

import { ACTIVITY_LIMIT } from "@/core/activity";
import { AppError } from "@/core/errors";
import { can } from "@/core/permissions";
import { assertPermission } from "@/core/permissions/server";
import {
  describeProjectActivity,
  listClientProjects,
  listProjectsActivity,
} from "@/modules/client-work";
import {
  type ActivityLine,
  describeClientActivity,
  getClient,
  listClientActivity,
  listContacts,
} from "@/modules/clients";
import { listDirectory } from "@/modules/team";

/** What the client page's History sheet shows: the newest lines, and the cap when more were cut. */
export type ClientHistoryData = { lines: ActivityLine[]; limitedTo: number | null };

const inputSchema = z.object({ clientId: z.uuid() });

/**
 * A client's history (3.4, PRODUCT §4.4; the header's History sheet since the v1.8 consistency
 * sweep): the latest changes to the client, its brand, its contacts, (for the Owner) its private
 * notes and its projects, newest first, one sentence each, read from the audit log under RLS.
 * **Read only when the sheet opens** (a background call, ARCHITECTURE §4.4), never with the
 * client's layout: a row's prefetch reads the layout's few reads alone (P2 item 6). The Owner and
 * the client's Admin (another Admin's client reads as not found under RLS); Crew never. The close
 * reason is the Owner's: it lives in an Owner-only table, and is shown to clients.manage only.
 */
export async function readClientHistory(input: unknown): Promise<ClientHistoryData> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION");
  const { clientId } = parsed.data;
  const viewer = await assertPermission(["clients.manage", "clients.edit_assigned"]);
  const [client, members, contacts, projects] = await Promise.all([
    getClient(clientId),
    listDirectory(),
    listContacts(clientId),
    listClientProjects(clientId),
  ]);
  if (!client) throw new AppError("NOT_FOUND");
  // The client's projects' own entries (7.3): created, started, completed, cancelled, reopened,
  // their details; an item's history lives on its project's page. Merged newest first.
  const [clientEntries, projectEntries] = await Promise.all([
    listClientActivity(
      client.id,
      contacts.map((contact) => contact.id),
    ),
    listProjectsActivity(projects.map((project) => project.id)),
  ]);
  const names = Object.fromEntries(members.map((member) => [member.id, member.fullName]));
  const projectNames = Object.fromEntries(projects.map((project) => [project.id, project.name]));
  const context = {
    names,
    contacts: Object.fromEntries(contacts.map((contact) => [contact.id, contact.name])),
    showCloseReason: can(viewer.role, "clients.manage"),
    viewerId: viewer.id,
  };
  const lines = [
    ...clientEntries.flatMap((entry) => {
      const line = describeClientActivity(entry, context);
      return line ? [line] : [];
    }),
    ...projectEntries.flatMap((entry) => {
      const line = describeProjectActivity(entry, {
        names,
        items: {},
        stages: {},
        projects: projectNames,
        viewerId: viewer.id,
      });
      return line ? [line] : [];
    }),
  ]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
    .slice(0, ACTIVITY_LIMIT);
  return {
    lines,
    limitedTo:
      clientEntries.length + projectEntries.length >= ACTIVITY_LIMIT ? ACTIVITY_LIMIT : null,
  };
}
