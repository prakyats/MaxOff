import { describe, expect, it } from "vitest";

import {
  clearOfflineTry,
  istDateOf,
  OFFLINE_TRY_KEY,
  readOfflineTry,
  recordOfflineTry,
  safeStorage,
  type TryStorage,
} from "../domain/offline-tries";

function memory(): TryStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("Start day tried with no network (v7.0 unit 2, owner Q1/Q2)", () => {
  it("names the IST day, across UTC midnight", () => {
    expect(istDateOf(new Date("2026-11-24T18:29:00Z"))).toBe("2026-11-24");
    expect(istDateOf(new Date("2026-11-24T18:31:00Z"))).toBe("2026-11-25");
  });

  it("keeps the first try of the day, not a later one", () => {
    const storage = memory();
    const first = recordOfflineTry(storage, new Date("2026-11-25T04:28:00Z"));
    recordOfflineTry(storage, new Date("2026-11-25T04:35:00Z"));
    expect(readOfflineTry(storage, "2026-11-25")).toEqual(first);
    expect(first.triedAt).toBe("2026-11-25T04:28:00.000Z");
  });

  it("forgets yesterday's try, and a used one", () => {
    const storage = memory();
    recordOfflineTry(storage, new Date("2026-11-24T04:28:00Z"));
    expect(readOfflineTry(storage, "2026-11-25")).toBeNull();
    recordOfflineTry(storage, new Date("2026-11-25T04:28:00Z"));
    expect(readOfflineTry(storage, "2026-11-25")?.date).toBe("2026-11-25");
    clearOfflineTry(storage);
    expect(readOfflineTry(storage, "2026-11-25")).toBeNull();
  });

  it("reads nothing from a damaged entry, and never throws on blocked storage", () => {
    const storage = memory();
    storage.setItem(OFFLINE_TRY_KEY, "{not json");
    expect(readOfflineTry(storage, "2026-11-25")).toBeNull();
    const blocked = safeStorage(() => {
      throw new Error("SecurityError");
    });
    expect(() => recordOfflineTry(blocked, new Date("2026-11-25T04:28:00Z"))).not.toThrow();
    expect(readOfflineTry(blocked, "2026-11-25")).toBeNull();
  });
});
