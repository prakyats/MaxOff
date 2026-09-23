/** One entry of the job-title list (`core/lists`), as a picker needs it. */
export type JobTitleOption = { id: string; name: string; archived?: boolean };

/**
 * What a picker may offer: the live titles, plus the archived one the person already carries,
 * so editing anything else about them does not quietly clear their title (1.3 follow-up).
 * Archiving is how a title is retired (CLAUDE.md invariant 9), and the people who have it keep it.
 */
export function offerableJobTitles(
  options: readonly JobTitleOption[],
  currentId: string | null,
): JobTitleOption[] {
  return options.filter((option) => !option.archived || option.id === currentId);
}
