/**
 * What an edit changed, and how to say it (ARCHITECTURE §14.1, task 2.9). The confirmation
 * before a save names every change ("Your name will change from Asha to Asha Rao"), never a
 * generic "Are you sure?". Pure, so the copy is unit-tested and every screen says it the same way.
 */

/** A field's value as the screen shows it. `null`, `undefined` and blanks all mean "none". */
export type FieldValue = string | null | undefined;

export interface Change {
  name: string;
  /** "" when there was none. */
  from: string;
  /** "" when there is none now. */
  to: string;
}

/** Whose record it is: "self" ("Your name …") or a person's display name ("Ravi's role …"). */
export type ChangeSubject = "self" | string;

/** Trimmed, with every kind of empty folded into "": what counts as a real difference. */
export function normalise(value: FieldValue): string {
  return (value ?? "").trim();
}

/** The fields whose value really changed, in the order given. Whitespace alone is no change. */
export function diffFields(
  names: readonly string[],
  before: Readonly<Record<string, FieldValue>>,
  after: Readonly<Record<string, FieldValue>>,
): Change[] {
  return names.flatMap((name) => {
    const from = normalise(before[name]);
    const to = normalise(after[name]);
    return from === to ? [] : [{ name, from, to }];
  });
}

function possessive(subject: ChangeSubject): string {
  return subject === "self" ? "Your" : `${subject}'s`;
}

/**
 * One line of the confirmation. `noun` is how the field reads in a sentence ("name", "phone
 * number", "role").
 */
export function describeChange(change: Change, noun: string, subject: ChangeSubject): string {
  const whose = `${possessive(subject)} ${noun}`;
  if (change.from === "") return `${whose} will be set to ${change.to}.`;
  if (change.to === "") return `${whose} will be removed.`;
  return `${whose} will change from ${change.from} to ${change.to}.`;
}
