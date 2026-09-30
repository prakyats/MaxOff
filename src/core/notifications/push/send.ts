import { buffer, utf8 } from "./base64url";
import { encryptPayload, type SubscriptionKeys } from "./encrypt";
import { vapidAuthorization, type VapidKeys } from "./vapid";

/**
 * One Web Push request (RFC 8030 §5, RFC 8291, RFC 8292): the payload encrypted for the
 * subscription and POSTed to its endpoint with the VAPID header. `fetch` is a parameter so the
 * dispatcher's tests and the e2e fake endpoint stand in for the push services.
 *
 * The push service's answer, reduced to what the dispatcher acts on (WORKFLOWS §9a):
 * - `sent`: 200, 201 or 202 (accepted for delivery; the device may still be offline).
 * - `gone`: 404 or 410, the subscription no longer exists: disabled 'gone'.
 * - `error`: anything else, including a network failure: retried with backoff, and the
 *   subscription's failure count grows.
 */
export type PushOutcome = "sent" | "gone" | "error";

export interface PushTarget extends SubscriptionKeys {
  endpoint: string;
}

/** What the service worker's `push` handler reads (`public/sw.js`). Never money (decision 24). */
export interface PushMessage {
  title: string;
  body: string | null;
  /** The app route the tap opens through the deep-link entry (ARCHITECTURE §14.2 h). */
  url: string;
  /** Collapses repeats of the same notification on the device. */
  tag: string;
  notificationId: string | null;
}

export type PushFetch = (url: string, init: RequestInit) => Promise<Response>;

/** A push lives a day on the service: a phone off overnight still gets the morning's. */
const TTL_SECONDS = 24 * 60 * 60;

export function classifyStatus(status: number): PushOutcome {
  if (status === 200 || status === 201 || status === 202) return "sent";
  if (status === 404 || status === 410) return "gone";
  return "error";
}

export async function sendWebPush(input: {
  target: PushTarget;
  message: PushMessage;
  vapid: VapidKeys;
  fetch: PushFetch;
  urgency?: "normal" | "high";
}): Promise<{ outcome: PushOutcome; status: number | null; detail: string | null }> {
  const body = await encryptPayload(utf8(JSON.stringify(input.message)), input.target);
  const authorization = await vapidAuthorization(input.vapid, input.target.endpoint);
  try {
    const response = await input.fetch(input.target.endpoint, {
      method: "POST",
      headers: {
        authorization,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL_SECONDS),
        urgency: input.urgency ?? "normal",
      },
      body: buffer(body),
    });
    const outcome = classifyStatus(response.status);
    return {
      outcome,
      status: response.status,
      detail: outcome === "sent" ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      outcome: "error",
      status: null,
      detail: error instanceof Error ? error.message.slice(0, 200) : "fetch failed",
    };
  }
}
