import "server-only";

import type { CurrentMember } from "@/core/auth/server";
import { todayIST } from "@/core/time";
import { getSettings } from "@/modules/settings";
import { activeTemplates } from "@/modules/tasks";
import type { TaskFormSetup } from "@/modules/tasks/components/task-form-dialog";

import {
  readCoordinators,
  readDirectory,
  readLabelClients,
  readTaskDefinitions,
  readTaskTemplates,
  readTaskTypes,
} from "./reads";

/**
 * What the create / edit dialog needs (4.3), composed by the route from the modules that own it:
 * the task types (tasks), the people and their coordinators (team, ADR-0013), the client labels
 * the viewer may set (clients: RLS gives an Admin their own, kickoff 4 decision 2), the workload
 * threshold (settings, decision 11), the task custom fields (`core/custom-fields`) and the active
 * templates for "Start from" (tasks, 4.6). Started by the page and handed to the dialog as a
 * promise, so the screen never waits for it.
 */
export async function loadTaskFormSetup(viewer: CurrentMember): Promise<TaskFormSetup> {
  const [types, directory, coordinators, clients, settings, definitions, templates] =
    await Promise.all([
      readTaskTypes(),
      readDirectory(),
      readCoordinators(),
      // Kickoff 4 decision 22: a label is an Active or Paused client (a draft may have no Admin).
      readLabelClients(),
      getSettings(),
      readTaskDefinitions(),
      readTaskTemplates(),
    ]);
  const names = new Map(directory.map((member) => [member.id, member.fullName]));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    viewerId: viewer.id,
    isOwner: viewer.role === "owner",
    today: todayIST(),
    threshold: settings.workloadWarningThreshold,
    types,
    // Kickoff 4 decision 1: never the Owner; only active people can be assigned.
    people: directory
      .filter((member) => member.status === "active" && member.role !== "owner")
      .map((member) => {
        const coordinatorId = coordinators[member.id];
        return {
          id: member.id,
          name: member.fullName,
          role: member.role,
          engagement: member.engagement,
          jobTitle: member.jobTitle,
          coordinatorName:
            member.engagement === "freelance" && coordinatorId
              ? (names.get(coordinatorId) ?? null)
              : null,
        };
      })
      .sort(byName),
    clients: clients
      .map((client) => ({ id: client.id, name: client.name, adminId: client.adminId }))
      .sort(byName),
    // Kickoff 4 decision 3: any active Admin (a permanent employee: a freelancer is never one).
    admins: directory
      .filter(
        (member) =>
          member.role === "admin" &&
          member.status === "active" &&
          member.engagement === "permanent",
      )
      .map((member) => ({ id: member.id, name: member.fullName }))
      .sort(byName),
    definitions,
    // A template of an archived type is not offered: the type would be refused (4B review S7).
    templates: activeTemplates(templates).filter((template) =>
      types.some((type) => type.id === template.taskTypeId && !type.archived),
    ),
  };
}
