import { notFound } from "next/navigation";

import { requirePermission } from "@/core/permissions/server";
import { getOwnMember, type TeamMember } from "@/modules/team";

/**
 * A person's history is the Owner's (`attendance.view_all`, PERMISSIONS "Screens (2.4)"). The
 * Owner has no attendance of their own, and an unknown id is a 404, not an empty page.
 */
export async function loadPerson(id: string): Promise<TeamMember> {
  await requirePermission("attendance.view_all");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const person = await getOwnMember(id);
  if (!person || person.role === "owner") notFound();
  return person;
}
