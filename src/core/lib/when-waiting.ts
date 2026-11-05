/**
 * A list read only once the shell's counts say one is waiting (v1.9 early leaves, v2.0 X3
 * Approvals): `counts` is the counts' read, `count` picks this list's (null for anyone who does
 * not decide it), and `read` is the list. A count of 0 or null gives an empty list without a
 * read: the count is the same state under the same RLS, so the list would be empty. **Counts that
 * could not be read ask the usual way**, so a failed count never hides a list.
 */
export function whenWaiting<C, T>(
  counts: Promise<C>,
  count: (counts: C) => number | null,
  read: () => Promise<T[]>,
): Promise<T[]> {
  return counts.then(
    (answer) => ((count(answer) ?? 0) > 0 ? read() : []),
    () => read(),
  );
}
