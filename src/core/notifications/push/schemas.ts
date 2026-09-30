import { z } from "zod";

/** The subscription the browser hands over (`PushSubscription.toJSON()` plus the device facts). */
export const subscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  p256dh: z.string().trim().min(1).max(512),
  auth: z.string().trim().min(1).max(512),
  platform: z.enum(["android", "ios", "desktop", "other"]),
  isStandalone: z.boolean(),
  label: z.string().trim().max(120).nullable(),
  userAgent: z.string().trim().max(512).nullable(),
});
export type SubscriptionPayload = z.infer<typeof subscriptionSchema>;

export const endpointSchema = z.object({ endpoint: z.url().max(2048) });
export type EndpointInput = z.infer<typeof endpointSchema>;
