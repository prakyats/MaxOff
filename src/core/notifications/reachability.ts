import { z } from "zod";

/**
 * Reachability (task 5.4, WORKFLOWS §9a "Reachability", PERMISSIONS `notifications.reachability`):
 * whether MaxOff can reach a member by push, and why not. The state comes from the database
 * (`app.reachability_state`); this file only puts it in words. Pure: no React, no database.
 */
export const REACHABILITY_STATES = [
  "ok",
  "no_subscription",
  "permission_revoked",
  "ios_not_installed",
  "failing",
] as const;
export type ReachabilityState = (typeof REACHABILITY_STATES)[number];

/**
 * Each state in plain words, the same words as the Owner's alert (`app.reachability_reason`).
 * "Their phone" because the reader is always someone else (a member's own devices are on Me).
 */
const REASONS: Readonly<Record<ReachabilityState, string>> = {
  ok: "Reachable",
  no_subscription: "Notifications never turned on",
  permission_revoked: "Notifications blocked on their phone",
  ios_not_installed: "iPhone without MaxOff installed",
  failing: "Notifications keep failing",
};

export function reachabilityReason(state: ReachabilityState): string {
  return REASONS[state];
}

export const PLATFORMS = ["android", "ios", "desktop", "other"] as const;
export type AppPlatform = (typeof PLATFORMS)[number];

const PLATFORM_LABELS: Readonly<Record<AppPlatform, string>> = {
  android: "Android",
  ios: "iPhone or iPad",
  desktop: "Computer",
  other: "Other device",
};

/** The device a member uses, for the Owner; null when none is known yet. */
export function platformLabel(platform: AppPlatform | null): string | null {
  return platform === null ? null : PLATFORM_LABELS[platform];
}

/** One person on Settings → Notifications (`reachability_overview()`). */
export interface ReachabilityRow {
  memberId: string;
  fullName: string;
  state: ReachabilityState;
  /** The Owner's view only: the device and the last delivery that worked. */
  platform: AppPlatform | null;
  lastSuccessAt: string | null;
}

const rowSchema = z.object({
  member_id: z.string(),
  full_name: z.string(),
  state: z.enum(REACHABILITY_STATES),
  platform: z.enum(PLATFORMS).nullable(),
  last_success_at: z.string().nullable(),
});

/** The function's rows, checked; a row that is not one is dropped rather than shown wrongly. */
export function toReachabilityRows(rows: readonly unknown[]): ReachabilityRow[] {
  return rows.flatMap((row) => {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return [];
    return [
      {
        memberId: parsed.data.member_id,
        fullName: parsed.data.full_name,
        state: parsed.data.state,
        platform: parsed.data.platform,
        lastSuccessAt: parsed.data.last_success_at,
      },
    ];
  });
}

/** The app's report about itself when it opens (owner decision 2026-10-03). */
export const appReportSchema = z.object({
  platform: z.enum(PLATFORMS),
  isStandalone: z.boolean(),
});
export type AppReport = z.infer<typeof appReportSchema>;
