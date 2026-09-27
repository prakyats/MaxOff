import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { can } from "@/core/permissions";
import { requirePermission } from "@/core/permissions/server";
import { getPerson, type TeamMember } from "@/modules/team";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A person's page (kickoff 3): anyone with `team.view` opens a member's Profile; `team.manage`
 * reads the full row (email, dates), everyone else the directory (PERMISSIONS §2). The Owner's
 * own row lives on /me, so it goes there. An unknown id is a 404, not an empty page. Cached per
 * request: the layout's header and the page both ask.
 */
export const loadPerson = cache(async (id: string) => {
  const viewer = await requirePermission("team.view");
  if (!ID.test(id)) notFound();
  const person = await getPerson(id, can(viewer.role, "team.manage"));
  if (!person) notFound();
  if (person.id === viewer.id && person.role === "owner") redirect("/me");
  return { viewer, person };
});

/** Whether the viewer sees this person's leave and attendance (2.4): the Owner, once joined. */
export function showsHistory(viewer: { role: Parameters<typeof can>[0] }, person: TeamMember) {
  return (
    can(viewer.role, "attendance.view_all") && person.role !== "owner" && person.joinedAt !== null
  );
}

/**
 * The Leave and Attendance tabs (2.4): `attendance.view_all` (the Owner), for someone who has
 * joined and is not the Owner; anything else is a 404.
 */
export const loadHistoryPerson = cache(async (id: string): Promise<TeamMember> => {
  const viewer = await requirePermission("attendance.view_all");
  const { person } = await loadPerson(id);
  if (!showsHistory(viewer, person)) notFound();
  return person;
});
