import "server-only";

import { createServiceSupabase, type ServiceSupabase } from "@/core/db/service";

import type { ClaimedEmail, EmailStore } from "./email-dispatcher";

/**
 * The email dispatcher's database side (CLAUDE.md rule 3: `core/notifications` owns these
 * tables), with the service role: `email_claim` and `email_record` (migration `email_dispatch`)
 * are service_role only. Every write is inside those functions; this file only maps rows.
 */
export function supabaseEmailStore(client: ServiceSupabase = createServiceSupabase()): EmailStore {
  return {
    async claim(now, limit) {
      const { data, error } = await client.rpc("email_claim", {
        p_now: now.toISOString(),
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row): ClaimedEmail => ({
        deliveryId: row.delivery_id ?? "",
        recipientId: row.recipient_id ?? "",
        email: row.email ?? "",
        notificationId: row.notification_id ?? "",
        kind: row.kind ?? "",
        title: row.title ?? "",
        body: row.body,
        link: row.link,
        attempts: row.attempts ?? 0,
        // A function's columns are typed not-null; a lone email's batch is null.
        batchId: (row.batch_id as string | null) ?? null,
        escalationLevel: row.escalation_level ?? 0,
        payload: row.payload,
      }));
    },
    async record(deliveryId, outcome, errorText, now) {
      const { error } = await client.rpc("email_record", {
        p_id: deliveryId,
        p_outcome: outcome,
        ...(errorText === null ? {} : { p_error: errorText }),
        p_now: now.toISOString(),
      });
      if (error) throw error;
    },
  };
}
