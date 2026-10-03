import { subscribePush } from "../actions";
import { toPayload, trySubscribeBrowser } from "./browser";

/**
 * "Turn on" on this device, wherever it is offered (the band's sheet, a new joiner's walkthrough):
 * the permission, asked only on the tap (kickoff 5 decision 9), the browser's subscription and the
 * server's row. Never throws for what the browser decides: a refusal or a subscribe the browser
 * could not complete is an outcome to explain (owner 2026-10-01), not a request to retry.
 */
export type TurnOnOutcome =
  | { kind: "on" }
  | { kind: "blocked" }
  | { kind: "brave" }
  | { kind: "failed" }
  | { kind: "error"; result: Awaited<ReturnType<typeof subscribePush>> };

export async function turnOnHere(publicKey: string): Promise<TurnOnOutcome> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { kind: "blocked" };
  const attempt = await trySubscribeBrowser(publicKey);
  if (!attempt.ok) {
    if (attempt.failure === "denied") return { kind: "blocked" };
    return { kind: attempt.failure === "brave" ? "brave" : "failed" };
  }
  const result = await subscribePush(toPayload(attempt.subscription));
  return result.ok ? { kind: "on" } : { kind: "error", result };
}
