import { describeChange, diffFields } from "@/core/ui/edit/changes";

import type { JobTitleOption } from "../domain/job-titles";
import { ROLE_LABELS, type TeamMember } from "../domain/members";

export interface MemberDraft {
  fullName: string;
  role: TeamMember["role"];
  /** "" for no job title. */
  jobTitleId: string;
}

const NOUNS = { fullName: "name", role: "role", jobTitle: "job title" } as const;

/**
 * What the Owner's edit of a member changes, as the confirmation's lines (task 2.9, owner
 * decision): "Ravi's role will change from Staff to Admin." A role change changes what the
 * person may do, so it is named before it is saved, like every edit of a record (§14.1).
 * Compared as the screen shows them: role labels and job title names, not ids.
 */
export function memberChangeLines(
  member: TeamMember,
  draft: MemberDraft,
  jobTitles: readonly JobTitleOption[],
): string[] {
  const titleName = (id: string | null) => jobTitles.find((title) => title.id === id)?.name ?? "";
  const before = {
    fullName: member.fullName,
    role: ROLE_LABELS[member.role],
    jobTitle: titleName(member.jobTitleId),
  };
  const after = {
    fullName: draft.fullName,
    role: ROLE_LABELS[draft.role],
    jobTitle: titleName(draft.jobTitleId || null),
  };
  return diffFields(["fullName", "role", "jobTitle"], before, after).map((change) =>
    describeChange(change, NOUNS[change.name as keyof typeof NOUNS], member.fullName),
  );
}
