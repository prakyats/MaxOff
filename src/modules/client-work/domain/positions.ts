/**
 * Fractional list positions (7A mechanics (6)): keys of `[0-9a-z]{1,64}` compared byte by byte
 * (`collate "C"`), so a row moves by taking a key between its new neighbours and no other row is
 * rewritten. Pure, unit-tested.
 */

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/** A key strictly between `before` and `after` (null: the start or the end of the list). */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new RangeError(`No key fits between ${before} and ${after}`);
  }
  const low = before ?? "";
  let high = after;
  let key = "";
  for (let i = 0; i < 64; i += 1) {
    const lowDigit = i < low.length ? DIGITS.indexOf(low[i] ?? "0") : 0;
    const highDigit = high !== null && i < high.length ? DIGITS.indexOf(high[i] ?? "0") : BASE;
    if (highDigit - lowDigit > 1) return key + DIGITS[Math.floor((lowDigit + highDigit) / 2)];
    key += DIGITS[lowDigit];
    // Once the key is below `high` at this digit, anything longer stays below it.
    if (highDigit - lowDigit === 1) high = null;
  }
  throw new RangeError("The positions are too long to fit another key between them");
}

/**
 * The key that moves `rows[index]` one place up or down in an ordered list, or null when it is
 * already at that end.
 */
export function movedPosition(
  rows: readonly { position: string }[],
  index: number,
  direction: "up" | "down",
): string | null {
  if (direction === "up") {
    if (index <= 0) return null;
    return positionBetween(rows[index - 2]?.position ?? null, rows[index - 1]?.position ?? null);
  }
  if (index >= rows.length - 1) return null;
  return positionBetween(rows[index + 1]?.position ?? null, rows[index + 2]?.position ?? null);
}
