import "server-only";

import { createServerSupabase } from "@/core/db/server";

/**
 * A member's own push subscriptions (DATA-MODEL §9 `push_subscriptions`, WORKFLOWS §9a), read
 * and written as the member (RLS: own rows only; the endpoint never leaves the member's own
 * session). The writes are the three `push_subscription_*` RPCs of migration `push_dispatch`.
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
  createdAt: string;
  lastSuccessAt: string | null;
  lastTestAt: string | null;
  failureCount: number;
  /** Null while active; 'gone' | 'expired' | 'signed_out' | 'deactivated' once disabled. */
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
      "id, endpoint, p256dh, auth, platform, is_standalone, label, created_at, last_success_at, last_test_at, failure_count, disabled_reason",
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
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
    lastTestAt: row.last_test_at,
    failureCount: row.failure_count,
    disabledReason: row.disabled_reason,
  }));
}

/** What the banner and Me need: the caller's active endpoints (their own devices). */
export async function listOwnActiveEndpoints(): Promise<string[]> {
  const rows = await listOwnPushSubscriptions();
  return rows.filter((row) => row.disabledReason === null).map((row) => row.endpoint);
}

export async function rpcPushSubscriptionUpsert(input: SubscriptionInput): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("push_subscription_upsert", {
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    platform: input.platform,
    is_standalone: input.isStandalone,
    ...(input.label === null ? {} : { label: input.label }),
    ...(input.userAgent === null ? {} : { user_agent: input.userAgent }),
  });
  if (error) throw error;
  return data;
}

export async function rpcPushSubscriptionRemove(endpoint: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("push_subscription_remove", { endpoint });
  if (error) throw error;
  return data;
}

export async function rpcPushSubscriptionsTested(): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("push_subscriptions_tested");
  if (error) throw error;
  return data;
}
