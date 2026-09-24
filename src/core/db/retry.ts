/**
 * Postgres aborts one side of a deadlock (`40P01`). The Owner functions take the person's
 * `leave:` lock before any row lock (2.4), so two decisions on one person wait for each other
 * instead; the retry stays as the safety net WORKFLOWS §1 names for the bulk action: the row is
 * tried **once** more, and a second failure is that row's error like any other.
 */
export function isDeadlock(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "40P01"
  );
}

export async function withDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isDeadlock(error)) throw error;
    return run();
  }
}
