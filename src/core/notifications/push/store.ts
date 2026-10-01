import "server-only";

import { createServiceSupabase, type ServiceSupabase } from "@/core/db/service";

import type { ClaimedItem, PushStore, PushTargetRow } from "./dispatcher";
import type { PushOutcome } from "./send";

/**
 * The dispatcher's database side (CLAUDE.md rule 3: `core/notifications` owns these tables),
 * with the service role: the four `public.push_*` functions of migration `push_dispatch` are
 * service_role only, so nothing here can run as a member. Every write is inside those
 * functions; this file only maps rows.
 */
export function supabasePushStore(client: ServiceSupabase = createServiceSupabase()): PushStore {
  return {
    async claim(now, limit) {
      const { data, error } = await client.rpc("push_claim", {
        p_now: now.toISOString(),
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row): ClaimedItem => ({
        deliveryIds: row.delivery_ids ?? [],
        recipientId: row.recipient_id ?? "",
        notificationId: row.notification_id,
        kind: row.kind ?? "",
        title: row.title ?? "",
        body: row.body,
        link: row.link,
        attempts: row.attempts ?? 0,
        isSummary: row.is_summary ?? false,
        heldCount: row.held_count ?? 1,
      }));
    },
    async targets(recipientId) {
      const { data, error } = await client.rpc("push_targets", { p_recipient: recipientId });
      if (error) throw error;
      return (data ?? []).map((row): PushTargetRow => ({
        id: row.id ?? "",
        endpoint: row.endpoint ?? "",
        p256dh: row.p256dh ?? "",
        auth: row.auth ?? "",
      }));
    },
    async record(deliveryIds, outcome, errorText, now) {
      const { error } = await client.rpc("push_record", {
        p_ids: deliveryIds,
        p_outcome: outcome,
        ...(errorText === null ? {} : { p_error: errorText }),
        p_now: now.toISOString(),
      });
      if (error) throw error;
    },
    async subscriptionResult(subscriptionId, outcome: PushOutcome, now) {
      const { error } = await client.rpc("push_subscription_result", {
        p_id: subscriptionId,
        p_outcome: outcome,
        p_now: now.toISOString(),
      });
      if (error) throw error;
    },
  };
}
