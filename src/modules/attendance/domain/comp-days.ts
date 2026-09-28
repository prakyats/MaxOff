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
