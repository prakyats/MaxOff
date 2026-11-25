"use client";

import { systemClock } from "@/core/time/clock";

import { noteOfflineTry } from "../actions/hours";
import {
  clearOfflineTry,
  istDateOf,
  readOfflineTry,
  recordOfflineTry,
  safeStorage,
} from "../domain/offline-tries";

/**
 * The phone's first Start try with no network (v7.0; owner Q2, 14 Nov 2026), loaded only when a
 * tap needs it (`day-actions.tsx`): My Day's and Today's first load carry none of it.
 */
const storage = safeStorage(() => window.localStorage);

/** Today's remembered try (an ISO instant, phone time), or null. */
export function storedTryToday(): string | null {
  return readOfflineTry(storage, istDateOf(systemClock()))?.triedAt ?? null;
}

/** Remembers a tap made with no network at `at`: the day's first stays. */
export function rememberTry(at: Date): void {
  recordOfflineTry(storage, at);
}

/**
 * After a Start that reached MaxOff: today's remembered try goes to the day as a note
 * (`attendance_note_offline_try`; kept only for a Late start), then the store is cleared. Nothing
 * here ever blocks or undoes the start: a failed note is simply not kept.
 */
export async function sendStoredTry(): Promise<void> {
  const triedAt = storedTryToday();
  if (triedAt) {
    try {
      await noteOfflineTry({ triedAt });
    } catch {
      // The network again: the start stands, the note is not kept.
    }
  }
  clearOfflineTry(storage);
}
