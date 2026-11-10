/**
 * An instant's IST time of day, `9:41 am`, without date-fns: for a browser module on a first-load
 * screen (Start day's live "records 9:41 am" on My Day and Today, PP-crew-2) that must not bring
 * date-fns-tz with it (task 2.8). The same words as `formatTime` (`ist.ts`; a unit test holds
 * them equal).
 *
 * **Made on first use, not when the module loads (v2.0 X3 (d)):** a page's first `Intl` formatter
 * with a time zone loads the browser's time-zone data, ≈ 48 ms at CPU ×4 on a phone, and as a
 * module constant it ran inside My Day's hydration. Its callers tick after hydration, in a task of
 * their own (`day-actions.tsx`, `hours-sheets.tsx`).
 */
let clock: Intl.DateTimeFormat | null = null;

export function clockWords(instant: Date): string {
  clock ??= new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
  return clock.format(instant).replace(/[  ]/g, " ").toLowerCase();
}
