import "server-only";

import { assertPermission } from "@/core/permissions/server";
import { listClientsRunBy } from "@/modules/clients";
import { countOpenAssignments } from "@/modules/tasks";

import * as repo from "../data/members";
import { coordinatorOptions } from "../domain/members";
import { memberIdSchema } from "../domain/schemas";

/**
 * The team module's **background calls** (ARCHITECTURE §4.4): what the Owner's dialogs read as
 * they open. Not server actions: plain server functions behind route handlers (`/api/team/*`),
 * which the dialogs reach with `fetch` from an effect, because a server action sent during a
 * navigation holds the new page until it answers. Each is the action it replaced: zod →
 * `assertPermission("team.manage")` → the repository.
 */

export type ClientHandoverData = {
  clients: { id: string; name: string }[];
  /** Every other active Admin, by name: who may take the clients. */
  admins: { id: string; name: string }[];
};

/**
 * What an Admin runs and who may take it, read when the Owner opens a demotion or a deactivation
 * (phase 3 review, owner: no client is ever left without an Admin): `GET /api/team/client-handover`.
 */
export async function readClientHandover(input: unknown): Promise<ClientHandoverData> {
  const { memberId } = memberIdSchema.parse(input);
  await assertPermission("team.manage");
  const [clients, members] = await Promise.all([listClientsRunBy(memberId), repo.listMembers()]);
  const admins = members
    .filter((member) => member.role === "admin" && member.status === "active")
    .filter((member) => member.id !== memberId)
    .map((member) => ({ id: member.id, name: member.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { clients, admins };
}

export type CoordinatorChoices = {
  /** The freelancer's current coordinator, if any (none once deactivated). */
  current: { id: string; name: string } | null;
  /** Who may coordinate: every active permanent Admin or Staff member but the current one. */
  options: { id: string; name: string }[];
};

/**
 * Read when the Owner opens "Change coordinator" or a freelancer's reactivation (ADR-0013):
 * `GET /api/team/coordinator-choices`.
 */
export async function readCoordinatorChoices(input: unknown): Promise<CoordinatorChoices> {
  const { memberId } = memberIdSchema.parse(input);
  await assertPermission("team.manage");
  const [coordinators, members] = await Promise.all([
    repo.listCurrentCoordinators(),
    repo.listMembers(),
  ]);
  const currentId = coordinators[memberId] ?? null;
  const current = currentId ? members.find((member) => member.id === currentId) : undefined;
  return {
    current: current ? { id: current.id, name: current.fullName } : null,
    options: coordinatorOptions(members, [memberId, ...(currentId ? [currentId] : [])]),
  };
}

export type FreelancerHandoverData = {
  freelancers: { id: string; name: string }[];
  /** Who may take them: every other active permanent Admin or Staff member (decision 8). */
  coordinators: { id: string; name: string }[];
};

/**
 * The freelancers a person looks after now, and who may take them, read when the Owner opens a
 * deactivation (ADR-0013 §2: deactivating a coordinator first asks where their freelancers go):
 * `GET /api/team/freelancer-handover`.
 */
export async function readFreelancerHandover(input: unknown): Promise<FreelancerHandoverData> {
  const { memberId } = memberIdSchema.parse(input);
  await assertPermission("team.manage");
  const [coordinators, members] = await Promise.all([
    repo.listCurrentCoordinators(),
    repo.listMembers(),
  ]);
  const names = new Map(members.map((member) => [member.id, member]));
  const freelancers = Object.entries(coordinators)
    .filter(
      ([freelancer, coordinator]) =>
        coordinator === memberId && names.get(freelancer)?.status === "active",
    )
    .map(([freelancer]) => ({ id: freelancer, name: names.get(freelancer)?.fullName ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { freelancers, coordinators: coordinatorOptions(members, [memberId]) };
}

/**
 * The freelancer's open tasks, for the warning in "Invite as employee" (4A later item L5):
 * `GET /api/team/open-task-count`.
 */
export async function readOpenTaskCount(input: unknown): Promise<{ openTasks: number }> {
  const { memberId } = memberIdSchema.parse(input);
  await assertPermission("team.manage");
  return { openTasks: await countOpenAssignments(memberId) };
}
