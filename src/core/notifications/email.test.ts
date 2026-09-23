import { describe, expect, it, vi } from "vitest";

import { createEmailSender, logSender, resendSender } from "./email";
import { emailStartupWarning, readEmailEnv } from "./env";

const message = { to: "person@example.com", subject: "Hello", text: "Body" };

describe("readEmailEnv", () => {
  it("picks Resend when the key is set, with the configured sender", () => {
    expect(readEmailEnv({ RESEND_API_KEY: "re_123", EMAIL_FROM: "MaxOff <m@x.app>" })).toEqual({
      mode: "resend",
      apiKey: "re_123",
      from: "MaxOff <m@x.app>",
    });
  });

  it("falls back to the log sender when the key is missing or blank", () => {
    expect(readEmailEnv({}).mode).toBe("log");
    expect(readEmailEnv({ RESEND_API_KEY: "  " }).mode).toBe("log");
  });
});

describe("emailStartupWarning", () => {
  it("names the variable when mail is not configured, and is silent when it is", () => {
    expect(emailStartupWarning({})).toContain("RESEND_API_KEY");
    expect(emailStartupWarning({ RESEND_API_KEY: "re_1" })).toBeNull();
  });
});

describe("logSender", () => {
  it("never throws, reports not_configured, and shows the recipient only in development", async () => {
    const lines: string[] = [];
    const dev = logSender((line) => lines.push(line), true);
    await expect(dev.send(message)).resolves.toEqual({ ok: false, reason: "not_configured" });
    expect(lines[0]).toContain("person@example.com");
    expect(lines[0]).toContain("Hello");

    const prod = logSender((line) => lines.push(line), false);
    await prod.send(message);
    expect(lines[1]).not.toContain("person@example.com");
    expect(lines[1]).toContain("Hello");
  });
});

describe("resendSender", () => {
  it("posts to Resend with the key and returns the id", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        from: "MaxOff <m@x.app>",
        to: ["person@example.com"],
        subject: "Hello",
      });
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer re_123");
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    });
    const sender = resendSender("re_123", "MaxOff <m@x.app>", fetchImpl as unknown as typeof fetch);
    await expect(sender.send(message)).resolves.toEqual({
      ok: true,
      provider: "resend",
      id: "email_1",
    });
  });

  it("turns a provider failure or a network error into a result, never a throw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = resendSender(
      "re_123",
      "x@y",
      (async () => new Response("nope", { status: 422 })) as unknown as typeof fetch,
    );
    await expect(failing.send(message)).resolves.toEqual({
      ok: false,
      reason: "provider_error",
      status: 422,
    });
    const offline = resendSender("re_123", "x@y", (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch);
    await expect(offline.send(message)).resolves.toEqual({ ok: false, reason: "provider_error" });
    expect(error.mock.calls.flat().join(" ")).not.toContain("person@example.com");
    error.mockRestore();
  });
});

describe("createEmailSender", () => {
  it("chooses by configuration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await createEmailSender({ mode: "log", from: "x" }).send(message);
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
