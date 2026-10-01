import { z } from "zod";

import { fromBase64Url } from "./base64url";

/**
 * A Web Push key exactly as the browser makes it (5A review M1): base64url without padding,
 * decoding to `bytes` bytes; `point` = an uncompressed P-256 point (first byte 0x04). The same
 * rule as `app.push_key_valid` in the database: a malformed key would only fail later, inside
 * the dispatcher.
 */
function decodesTo(value: string, bytes: number, point: boolean): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length !== Math.ceil((bytes * 4) / 3)) return false;
  const decoded = fromBase64Url(value);
  return decoded.length === bytes && (!point || decoded[0] === 0x04);
}

export const p256dhSchema = z
  .string()
  .trim()
  .refine((value) => decodesTo(value, 65, true), "The subscription keys are not valid.");
export const authSecretSchema = z
  .string()
  .trim()
  .refine((value) => decodesTo(value, 16, false), "The subscription keys are not valid.");

/** The subscription the browser hands over (`PushSubscription.toJSON()` plus the device facts). */
export const subscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  p256dh: p256dhSchema,
  auth: authSecretSchema,
  platform: z.enum(["android", "ios", "desktop", "other"]),
  isStandalone: z.boolean(),
  label: z.string().trim().max(120).nullable(),
  userAgent: z.string().trim().max(512).nullable(),
});
export type SubscriptionPayload = z.infer<typeof subscriptionSchema>;

export const endpointSchema = z.object({ endpoint: z.url().max(2048) });
export type EndpointInput = z.infer<typeof endpointSchema>;
