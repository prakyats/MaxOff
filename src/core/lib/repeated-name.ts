/**
 * The first name in a list that repeats an earlier one, ignoring case and outer spaces, as typed
 * (trimmed); null when every name is its own. Stage lists use it (the 7B rework's review, S3): a
 * project's default stages, an item-list line's stages, a preset's and a project template's, so
 * "Tick ‹stage› on N" always finds one stage per item. The database refuses the same lists
 * (`app.client_work_stage_names`, VALIDATION).
 */
export function repeatedName(names: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (key === "") continue;
    if (seen.has(key)) return name.trim();
    seen.add(key);
  }
  return null;
}

/** The message a stage list naming one stage twice gets, in a form and from the server alike. */
export function repeatedStageMessage(name: string): string {
  return `The stage ${name} is listed twice: each stage needs its own name.`;
}
