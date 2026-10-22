/**
 * An instant's IST time of day, `9:41 am`, without date-fns: for a browser module on a first-load
 * screen (Start day's live "records 9:41 am" on My Day and Today, PP-crew-2) that must not bring
 * date-fns-tz with it (task 2.8). The same words as `formatTime` (`ist.ts`; a unit test holds
 * them equal).
 */
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

export function clockWords(instant: Date): string {
  return CLOCK.format(instant).replace(/[  ]/g, " ").toLowerCase();
}
