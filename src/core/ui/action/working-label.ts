/**
 * The working label of a named action (ARCHITECTURE §14.1, owner 2026-09-28): what its button
 * says while the action is on its way. The colour rule names every commit for what it does
 * ("Deactivate Ravi", "Approve 3", "Log out"), so the working label follows from it
 * ("Deactivating Ravi…", "Approving 3…", "Logging out…"): only the first word, the verb, changes.
 * A caller with a better phrase passes its own `pendingLabel`.
 */
const IRREGULAR: Record<string, string> = {
  Cancel: "Cancelling",
  Log: "Logging",
  Sign: "Signing",
  Stop: "Stopping",
  Submit: "Submitting",
  Set: "Setting",
  Get: "Getting",
  Plan: "Planning",
  Tick: "Ticking",
  Pay: "Paying",
};

function ing(verb: string): string {
  const irregular = IRREGULAR[verb];
  if (irregular) return irregular;
  if (/[^aeiou]e$/i.test(verb) && !/ee$/i.test(verb)) return `${verb.slice(0, -1)}ing`;
  return `${verb}ing`;
}

export function workingLabel(label: string): string {
  const [verb = "", ...rest] = label.trim().split(/\s+/);
  if (!verb) return "Working…";
  return `${[ing(verb), ...rest].join(" ")}…`;
}
