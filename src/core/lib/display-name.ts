/**
 * One display name everywhere (Kickoff 4 decision 30, owner 2026-09-30): a member is named by
 * their **full name**, as the Owner wrote it on People, on every screen, in every sentence, toast
 * and dialog ("Approved Ravi Kumar's leave", "Welcome, Prishit Shetty"). Never a first name cut
 * from it, never a username-style short name. Spaces are tidied (the ends trimmed, runs of
 * whitespace one space); nothing else changes. `fallback` names nobody in particular when the
 * name is missing (a read that raced).
 */
export function displayName(name: string | null | undefined, fallback = "Someone"): string {
  const tidy = (name ?? "").trim().replace(/\s+/g, " ");
  return tidy || fallback;
}
