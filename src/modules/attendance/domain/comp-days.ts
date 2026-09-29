/**
 * "½", "1", "1½": days of comp leave (or hours of overtime) in the words the screens use. Kept in
 * this module so the notes never import from `modules/leave` (modules are isolated); the leave
 * module has its own copy for credits.
 */
export function formatDays(days: number): string {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  if (whole === 0) return half ? "½" : "0";
  return half ? `${whole}½` : String(whole);
}

/** "½ day", "1 day", "1½ days": the balance in a sentence (the leave module has the same). */
export function daysLabel(days: number): string {
  return `${formatDays(days)} ${days === 1 || days === 0.5 ? "day" : "days"}`;
}
