"use client";

import { useState } from "react";

import { EditableRecord, type EditableField } from "@/core/ui/composites/editable-record";

import { updateMember } from "../actions/members";
import { offerableJobTitles, type JobTitleOption } from "../domain/job-titles";
import { INVITABLE_ROLES, NAME_MAX_LENGTH } from "../domain/limits";
import { memberActions, memberEditKey, ROLE_LABELS, type TeamMember } from "../domain/members";
import { ClientHandover, type HandoverMove } from "./client-handover";

type Field = "fullName" | "role" | "jobTitleId";

/**
 * A person's name, role and job title on their page (3.4, owner decision 2026-09-25): the edit
 * pattern (`EditableRecord`), read-only first; Edit for the Owner, from here or the header's ⋯
 * menu (`memberEditKey`). The confirmation names each change in the person's name ("Ravi's role
 * will change from Staff to Admin"): a role changes what they may do. Everyone else with
 * `team.view` reads the same values with no Edit. Making an Admin Staff moves their clients first,
 * chosen in the same confirmation (phase 3 review, owner: no client is ever left without an Admin).
 */
export function MemberProfile({
  member,
  viewer,
  jobTitles,
}: {
  member: TeamMember;
  viewer: { id: string; canManage: boolean };
  jobTitles: readonly JobTitleOption[];
}) {
  const { edit, editRole } = memberActions(viewer, member);
  const [moves, setMoves] = useState<HandoverMove[] | null>(null);
  const leavesAdmin = (role: string | undefined) =>
    editRole && member.role === "admin" && role !== undefined && role !== "admin";
  const role: EditableField<Field> = editRole
    ? {
        name: "role",
        label: "Role",
        noun: "role",
        value: member.role,
        kind: "select",
        options: INVITABLE_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
      }
    : { name: "role", label: "Role", noun: "role", value: ROLE_LABELS[member.role] };
  const fields: EditableField<Field>[] = [
    {
      name: "fullName",
      label: "Full name",
      noun: "name",
      value: member.fullName,
      input: { autoComplete: "off", maxLength: NAME_MAX_LENGTH, required: true },
    },
    // A role that cannot change is shown, never offered as an input.
    ...(edit && !editRole ? [] : [role]),
    {
      name: "jobTitleId",
      label: "Job title",
      noun: "job title",
      value: member.jobTitleId,
      kind: "select",
      noneLabel: "No job title",
      emptyLabel: "No job title",
      options: offerableJobTitles(jobTitles, member.jobTitleId).map((title) => ({
        value: title.id,
        label: title.name,
      })),
    },
  ];

  return (
    <EditableRecord<Field>
      title="Profile"
      subject={member.fullName}
      fields={fields}
      canEdit={edit}
      editKey={memberEditKey(member.id)}
      savedMessage="Saved"
      confirmation={(values) =>
        leavesAdmin(values.role)
          ? {
              content: <ClientHandover member={member} onChange={setMoves} />,
              ready: moves !== null,
            }
          : null
      }
      onSave={(values) =>
        updateMember({
          memberId: member.id,
          fullName: values.fullName,
          ...(editRole ? { role: values.role as (typeof INVITABLE_ROLES)[number] } : {}),
          jobTitleId: values.jobTitleId,
          ...(leavesAdmin(values.role) && moves?.length ? { handover: moves } : {}),
        })
      }
    />
  );
}
