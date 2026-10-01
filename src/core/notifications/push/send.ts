import { buffer, utf8 } from "./base64url";
import { encryptPayload, MAX_PLAINTEXT_BYTES, type SubscriptionKeys } from "./encrypt";
import { vapidAuthorization, type VapidKeys } from "./vapid";

/**
 * One Web Push request (RFC 8030 §5, RFC 8291, RFC 8292): the payload encrypted for the
 * subscription and POSTed to its endpoint with the VAPID header. `fetch` is a parameter so the
 * dispatcher's tests and the e2e fake endpoint stand in for the push services.
 *
 * The push service's answer, reduced to what the dispatcher acts on (WORKFLOWS §9a):
 * - `sent`: 200, 201 or 202 (accepted for delivery; the device may still be offline).
 * - `gone`: 404 or 410, the subscription no longer exists: disabled 'gone'.
 * - `error`: anything else, including a network failure, a timeout, a subscription whose keys
 *   cannot be used and an endpoint that is refused: retried with backoff, and the
 *   subscription's failure count grows (disabled 'expired' at the fifth in a row).
 *
 * Never throws (5A review M1): one bad subscription must not stall the run for everyone. The
 * `detail` is a short code, never a host or a message that could carry one.
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

export interface PushSendResult {
  outcome: PushOutcome;
  status: number | null;
  detail: string | null;
}

/** A push lives a day on the service: a phone off overnight still gets the morning's. */
const TTL_SECONDS = 24 * 60 * 60;
/** A push service that does not answer in 10 s is an error, retried later (5A review S1). */
export const PUSH_TIMEOUT_MS = 10_000;

export function classifyStatus(status: number): PushOutcome {
  if (status === 200 || status === 201 || status === 202) return "sent";
  if (status === 404 || status === 410) return "gone";
  return "error";
}

const PRIVATE_SUFFIX = /(^|\.)(localhost|local|internal|localdomain|home|lan)$/;
/** A DNS name with an alphabetic top-level label: never an IPv4 or [IPv6] literal. */
const DNS_NAME = /^([a-z0-9-]+\.)+[a-z][a-z0-9-]*$/;

/**
 * Whether the sender may POST to this endpoint (5A review M2, defence in depth behind the
 * database's own check in `push_subscription_upsert`): https on a public DNS name, as every push
 * service is; plain http only on the loopback host and only when `allowLoopback` (the e2e fake
 * push service; `pushLoopbackAllowed()`, never in staging or production).
 */
export function pushEndpointAllowed(endpoint: string, allowLoopback: boolean): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:") {
    return allowLoopback && (host === "127.0.0.1" || host === "localhost");
  }
  if (url.protocol !== "https:") return false;
  return DNS_NAME.test(host) && !PRIVATE_SUFFIX.test(host);
}

const ELLIPSIS = "…";

function encodeMessage(message: PushMessage): Uint8Array {
  return utf8(JSON.stringify(message));
}

/**
 * The message as the bytes to encrypt, always within one record (5A review M1): a body too long
 * is cut (whole characters, ending "…") until the JSON fits; the title, link and tag are never
 * touched. Only a title too long on its own could still not fit, and that send is an error.
 */
export function fitPayload(message: PushMessage): Uint8Array {
  const whole = encodeMessage(message);
  if (whole.length <= MAX_PLAINTEXT_BYTES || message.body === null) return whole;
  const chars = Array.from(message.body);
  let best = encodeMessage({ ...message, body: ELLIPSIS });
  let low = 0;
  let high = chars.length - 1;
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const candidate = encodeMessage({
      ...message,
      body: chars.slice(0, keep).join("").trimEnd() + ELLIPSIS,
    });
    if (candidate.length <= MAX_PLAINTEXT_BYTES) {
      best = candidate;
      low = keep + 1;
    } else {
      high = keep - 1;
    }
  }
  return best;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function sendWebPush(input: {
  target: PushTarget;
  message: PushMessage;
  vapid: VapidKeys;
  fetch: PushFetch;
  urgency?: "normal" | "high";
  /** Plain http on the loopback host (the e2e fake push service); `pushLoopbackAllowed()`. */
  allowLoopback?: boolean;
  timeoutMs?: number;
}): Promise<PushSendResult> {
  const error = (detail: string): PushSendResult => ({ outcome: "error", status: null, detail });
  if (!pushEndpointAllowed(input.target.endpoint, input.allowLoopback ?? false)) {
    return error("endpoint_refused");
  }
  let body: Uint8Array;
  try {
    body = await encryptPayload(fitPayload(input.message), input.target);
  } catch {
    // A malformed p256dh / auth, or a title too long for one record.
    return error("encrypt_failed");
  }
  let authorization: string;
  try {
    authorization = await vapidAuthorization(input.vapid, input.target.endpoint);
  } catch {
    return error("vapid_failed");
  }
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
      signal: AbortSignal.timeout(input.timeoutMs ?? PUSH_TIMEOUT_MS),
    });
    const outcome = classifyStatus(response.status);
    return {
      outcome,
      status: response.status,
      detail: outcome === "sent" ? null : `HTTP ${response.status}`,
    };
  } catch (failure) {
    return error(isTimeout(failure) ? "timeout" : "network_error");
  }
}
