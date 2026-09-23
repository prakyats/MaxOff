import { type EmailEnv, readEmailEnv } from "./env";

/**
 * The one way the app sends an email (ARCHITECTURE §9 `EmailChannel` builds on it in 5.2;
 * 1.3 invites are the first caller). `sendEmail()` never throws: with no provider it logs
 * and answers `not_configured`, so a missing key degrades to "no mail", never to a crash.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult =
  | { ok: true; provider: "resend"; id: string | null }
  | { ok: false; reason: "not_configured" | "provider_error"; status?: number };

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Resend's REST API through plain `fetch` (no SDK: it runs the same on the Worker). */
export function resendSender(
  apiKey: string,
  from: string,
  fetchImpl: typeof fetch = fetch,
): EmailSender {
  return {
    async send(message) {
      try {
        const response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html ? { html: message.html } : {}),
          }),
        });
        if (!response.ok) {
          // Status only: the body could quote the recipient.
          console.error(`[email] resend answered ${response.status}`);
          return { ok: false, reason: "provider_error", status: response.status };
        }
        const body = (await response.json().catch(() => null)) as { id?: string } | null;
        return { ok: true, provider: "resend", id: body?.id ?? null };
      } catch {
        console.error("[email] resend request failed");
        return { ok: false, reason: "provider_error" };
      }
    },
  };
}

/**
 * The fallback when `RESEND_API_KEY` is unset. In development it prints the intended mail
 * (recipient and subject) so the flow can be followed; elsewhere only the subject, since
 * logs must not carry personal data (ARCHITECTURE §18.2).
 */
export function logSender(
  log: (line: string) => void = console.warn,
  dev = isDevelopment(),
): EmailSender {
  return {
    async send(message) {
      log(
        dev
          ? `[email] not sent (no RESEND_API_KEY) to ${message.to}: "${message.subject}"`
          : `[email] not sent (no RESEND_API_KEY): "${message.subject}"`,
      );
      return { ok: false, reason: "not_configured" };
    },
  };
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

export function createEmailSender(env: EmailEnv = readEmailEnv()): EmailSender {
  return env.mode === "resend" ? resendSender(env.apiKey, env.from) : logSender();
}

export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  return createEmailSender().send(message);
}
