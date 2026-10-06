import "server-only";

import { createServerSupabase } from "@/core/db/server";
import { createServiceSupabase } from "@/core/db/service";
import { systemClock } from "@/core/time";

import { type BandReason, toBandReason } from "./band";

/**
 * A member's own push subscriptions (DATA-MODEL §9 `push_subscriptions`, WORKFLOWS §9a), read
 * and written as the member (RLS: own rows only; the endpoint never leaves the member's own
 * session). The writes are the `push_subscription_*` RPCs of migration `push_dispatch` and
 * `push_test_claim` (20261001053934); INSERT and UPDATE are not the API role's (5A review M2).
 */
export interface OwnPushSubscription {
  id: string;
  endpoint: string;
  /** The subscription's keys, needed to send (the test push); the member's own. */
  p256dh: string;
  auth: string;
  platform: "android" | "ios" | "desktop" | "other";
  isStandalone: boolean;
  label: string | null;
  /** The browser's user agent when it subscribed: Me names the device from it (5.5), never shows it. */
  userAgent: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  lastTestAt: string | null;
  failureCount: number;
  /**
   * Null while active; 'gone' | 'expired' | 'signed_out' | 'deactivated' | 'removed' once
   * disabled ('removed': Remove on Me's list, kept so the automatic re-subscribe leaves it off).
   */
  disabledReason: string | null;
}

export type Platform = OwnPushSubscription["platform"];

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: Platform;
  isStandalone: boolean;
  label: string | null;
  userAgent: string | null;
}

function toPlatform(value: string): Platform {
  return value === "android" || value === "ios" || value === "desktop" ? value : "other";
}

/** Every row of the caller, active ones first. */
export async function listOwnPushSubscriptions(): Promise<OwnPushSubscription[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select(
      "id, endpoint, p256dh, auth, platform, is_standalone, label, user_agent, created_at, last_success_at, last_test_at, failure_count, disabled_reason",
    )
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    platform: toPlatform(row.platform),
    isStandalone: row.is_standalone,
    label: row.label,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    lastTestAt: row.last_test_at,
    failureCount: row.failure_count,
    disabledReason: row.disabled_reason,
  }));
}

/**
 * The layout's one read for the band (5.5, `push_status_own()`): the caller's active endpoints
 * (this device's check, `PushSync`) and why the band shows (`app.push_band`), or null for none.
 * One call, as the endpoints alone were before.
 */
export async function readOwnPushStatus(): Promise<{
  endpoints: string[];
  band: BandReason | null;
}> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("push_status_own").maybeSingle();
  if (error) throw error;
  return { endpoints: data?.endpoints ?? [], band: toBandReason(data?.band ?? null) };
}

function subscriptionArgs(input: SubscriptionInput) {
  return {
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    platform: input.platform,
    is_standalone: input.isStandalone,
    ...(input.label === null ? {} : { label: input.label }),
    ...(input.userAgent === null ? {} : { user_agent: input.userAgent }),
  };
}

/**
 * The automatic subscribe (the re-subscribe on load, the service worker's subscription change):
 * refused with INVALID_STATE for a device the member removed from Me's list (owner 2026-10-06).
 */
export async function rpcPushSubscriptionUpsert(input: SubscriptionInput): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("push_subscription_upsert", subscriptionArgs(input));
  if (error) throw error;
  return data;
}

/**
 * The member's own tap on "Turn on" on this device (the band, Me, the walkthrough): the same rules,
 * and a device removed from Me's list comes back (owner 2026-10-06).
 */
export async function rpcPushSubscriptionTurnOn(input: SubscriptionInput): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("push_subscription_turn_on", subscriptionArgs(input));
  if (error) throw error;
  return data;
}

export async function rpcPushSubscriptionRemove(endpoint: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("push_subscription_remove", { endpoint });
  if (error) throw error;
  return data;
}

/**
 * "Remove" on Me's device list (5.5): one of the caller's own other devices stops getting
 * notifications (its row is kept, disabled 'removed', so it stays off when opened again; it is
 * not signed out). Anyone else's is NOT_FOUND.
 */
export async function rpcPushSubscriptionRemoveOwn(id: string): Promise<void> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("push_subscription_remove_own", { p_id: id });
  if (error) throw error;
}

/**
 * A test the push service accepted counts as a delivery (5.5, owner decision 2026-10-03: "the push
 * service accepting it counts as working"): the dispatcher's own `push_subscription_result(sent)`
 * (service_role) stamps `last_success_at` and clears the error count, which ends the band. Only
 * the ids of the caller's own devices the server just pushed to reach here.
 */
export async function recordTestDelivered(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const service = createServiceSupabase();
  const now = systemClock().toISOString();
  for (const id of ids) {
    const { error } = await service.rpc("push_subscription_result", {
      p_id: id,
      p_outcome: "sent",
      p_now: now,
    });
    if (error) throw error;
  }
}

/**
 * "Send a test notification" claims its send first (5A review S2): RATE_LIMITED while a test is
 * under 30 seconds old, else last_test_at is stamped on every active row. Returns how many.
 */
export async function rpcPushTestClaim(): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("push_test_claim");
  if (error) throw error;
  return data;
}
