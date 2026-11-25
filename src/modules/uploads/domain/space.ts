/**
 * The upload space guard's step and reserve (S7, WORKFLOWS §5B.6 Q11): a file starts only if it
 * fits in the studio Drive's free space rounded down to a `step`, less a `reserve` and the bytes
 * still to come. **The decided rule is 10 GB / 10 GB** and is the only one production uses.
 *
 * A test-only override (advisor, 25 Nov 2026): a free 15 GB Gmail (staging's test Drive) can never
 * take a file under the decided rule, so staging's Worker may set `UPLOAD_SPACE_STEP_BYTES` and
 * `UPLOAD_SPACE_RESERVE_BYTES` (non-secret). Unset, or anything that is not a whole number, is the
 * decided value. The database clamps them too (`upload_file_start_v2`: a step of at least 1 GB, a
 * reserve of at least 0).
 */
export const SPACE_GUARD = { stepBytes: 10_000_000_000, reserveBytes: 10_000_000_000 } as const;

export const SPACE_STEP_ENV = "UPLOAD_SPACE_STEP_BYTES";
export const SPACE_RESERVE_ENV = "UPLOAD_SPACE_RESERVE_BYTES";

const MIN_STEP = 1_000_000_000;

function whole(text: string | undefined): number | null {
  const value = text?.trim() ?? "";
  return /^\d{1,16}$/.test(value) ? Number(value) : null;
}

export function spaceGuard(env: Readonly<Record<string, string | undefined>>): {
  stepBytes: number;
  reserveBytes: number;
} {
  // Never in production, whatever the environment says (review pass 2): the decided rule.
  if (env.NEXT_PUBLIC_APP_ENV === "production") return { ...SPACE_GUARD };
  const step = whole(env[SPACE_STEP_ENV]);
  const reserve = whole(env[SPACE_RESERVE_ENV]);
  return {
    stepBytes: step === null ? SPACE_GUARD.stepBytes : Math.max(step, MIN_STEP),
    reserveBytes: reserve === null ? SPACE_GUARD.reserveBytes : reserve,
  };
}

/**
 * The line a Worker logs once when the override is active (staging; advisor 25 Nov 2026), so a
 * stray override anywhere else is seen at once. Null under the decided rule.
 */
export function spaceOverrideNote(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  if (env[SPACE_STEP_ENV] === undefined && env[SPACE_RESERVE_ENV] === undefined) return null;
  const { stepBytes, reserveBytes } = spaceGuard(env);
  if (stepBytes === SPACE_GUARD.stepBytes && reserveBytes === SPACE_GUARD.reserveBytes) return null;
  return `[uploads] the space guard's TEST override is active (staging only): a ${stepBytes}-byte step and a ${reserveBytes}-byte reserve, not the decided 10 GB / 10 GB.`;
}
