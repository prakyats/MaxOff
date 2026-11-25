/**
 * Start day with no network (v7.0 unit 2; owner Q1, 14 Nov 2026: **no offline queue**, "a tap
 * counts only when it reaches MaxOff"). A tap made offline sends nothing and says "No network, tap
 * again"; the phone remembers the **first** such try of the IST day, so the day can carry the
 * fact the owner asked to see (Q2: "Tried at 9:58, no network (phone time)"). The phone's clock is
 * only a note beside the server's time, never the record (invariant 7: the Owner decides).
 *
 * Pure: the storage is passed in (a browser's `localStorage` in the app, a map in tests). Nothing
 * here reads the clock; the caller gives the instant.
 */
export const OFFLINE_TRY_KEY = "maxoff:start-day-offline-try";

export type OfflineTry = { date: string; triedAt: string };

export interface TryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let istDate: Intl.DateTimeFormat | null = null;

/** The instant's IST date, `2026-11-25` (made on first use, as `clockWords`: no load-time cost). */
export function istDateOf(instant: Date): string {
  istDate ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return istDate.format(instant);
}

/** Remembers a try with no network: the first of its IST day stays, a later one changes nothing. */
export function recordOfflineTry(storage: TryStorage, instant: Date): OfflineTry {
  const date = istDateOf(instant);
  const kept = readOfflineTry(storage, date);
  if (kept) return kept;
  const entry = { date, triedAt: instant.toISOString() };
  storage.setItem(OFFLINE_TRY_KEY, JSON.stringify(entry));
  return entry;
}

/** The day's remembered try, or null (another day's is stale and read as none). */
export function readOfflineTry(storage: TryStorage, date: string): OfflineTry | null {
  const raw = storage.getItem(OFFLINE_TRY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfflineTry>;
    if (typeof parsed.date !== "string" || typeof parsed.triedAt !== "string") return null;
    if (Number.isNaN(Date.parse(parsed.triedAt))) return null;
    return parsed.date === date ? { date: parsed.date, triedAt: parsed.triedAt } : null;
  } catch {
    return null;
  }
}

/** Once the start has reached MaxOff, the try has been used. */
export function clearOfflineTry(storage: TryStorage): void {
  storage.removeItem(OFFLINE_TRY_KEY);
}

/** A storage that never throws: a private window or blocked storage remembers nothing. */
export function safeStorage(get: () => TryStorage | undefined): TryStorage {
  const run = <T>(fn: (storage: TryStorage) => T, fallback: T): T => {
    try {
      const storage = get();
      return storage ? fn(storage) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    getItem: (key) => run((storage) => storage.getItem(key), null),
    setItem: (key, value) => run((storage) => storage.setItem(key, value), undefined),
    removeItem: (key) => run((storage) => storage.removeItem(key), undefined),
  };
}
