/**
 * Starts reads a page will need **before** the session read has answered (ARCHITECTURE §19,
 * performance rules): the page calls this with `cache()`d reads, then awaits `requireMember()`,
 * and the component that renders the data calls the same read again and gets the promise
 * already in flight. A read the viewer turns out not to need (a role-specific one) is simply
 * dropped: its failure is swallowed here and never reaches an error boundary, because nothing
 * awaits it. Never an authorisation decision: RLS and the transition functions still decide
 * every row, and the page renders only after its permission check.
 */
export function startEarly(...reads: Promise<unknown>[]): void {
  for (const read of reads) read.catch(() => undefined);
}

/**
 * A permission check and the reads started with it: both are already in flight when this is
 * called, and the check is awaited **first**, so its redirect (sign-in, /forbidden) always wins
 * over a read that fails for a viewer who may not see the screen (an RPC that refuses, say). In
 * one `Promise.all` the read's failure could arrive first and show the error page instead
 * (found by the e2e suite, 2026-09-28).
 */
export async function checkThenRead<Checked, Read>(
  check: Promise<Checked>,
  reads: Promise<Read>,
): Promise<[Checked, Read]> {
  startEarly(reads);
  const checked = await check;
  return [checked, await reads];
}
