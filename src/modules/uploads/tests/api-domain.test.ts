import { describe, expect, it } from "vitest";

import { fromBytea, toBytea } from "../data/bytea";
import { readLinkKey } from "../data/link-key";
import {
  cleanIp,
  doneBodySchema,
  failedReasonOf,
  isDailyUploadLimit,
  registerBodySchema,
  secondsUntil,
  startBodySchema,
  hasNul,
} from "../domain/api";
import { toUploadCard, toUploaderSheet } from "../domain/card";
import {
  deriveLinkToken,
  deviceKeyHash,
  isDeviceKeyShaped,
  isTokenShaped,
  linkKeyBytes,
  rateKeyHash,
  tokenFromBody,
  withoutToken,
  tokenHash,
  uploadLinkUrl,
} from "../domain/token";
import { DEVICE_KEY, KEY_BASE64, TOKEN } from "./fakes";

describe("the token on the wire (plan A1, A8)", () => {
  it("is read from the JSON body's `token` only, never a header (review pass 2)", () => {
    expect(tokenFromBody({ token: TOKEN, deviceKey: "x" })).toBe(TOKEN);
    expect(tokenFromBody({ deviceKey: "x" })).toBeNull();
    expect(tokenFromBody({ token: 5 })).toBeNull();
    expect(tokenFromBody([TOKEN])).toBeNull();
    expect(tokenFromBody(null)).toBeNull();
    expect(withoutToken({ token: TOKEN, deviceKey: "x" })).toEqual({ deviceKey: "x" });
  });

  it("is shaped: 43 url-safe characters, nothing else", () => {
    expect(isTokenShaped(TOKEN)).toBe(true);
    expect(isTokenShaped(`${TOKEN}=`)).toBe(false);
    expect(isTokenShaped(TOKEN.replace("A", "+"))).toBe(false);
    expect(isTokenShaped(TOKEN.slice(1))).toBe(false);
  });

  it("goes in the link's fragment, never its path or query", async () => {
    const token = await deriveLinkToken({
      key: linkKeyBytes(KEY_BASE64),
      linkId: "link-1",
      salt: new Uint8Array(16),
    });
    const url = uploadLinkUrl("https://app.maxoff.in/", token);
    expect(url).toBe(`https://app.maxoff.in/upload#${token}`);
    expect(new URL(url).pathname).toBe("/upload");
    expect(new URL(url).search).toBe("");
  });

  it("is looked up by its sha256 only, sent to Postgres as hex", async () => {
    const hash = await tokenHash(TOKEN);
    const wire = toBytea(hash);
    expect(wire).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(fromBytea(wire)).toEqual(hash);
    expect(wire).not.toContain(TOKEN);
  });
});

describe("the device key and the network key (plan B3, C1)", () => {
  it("a device key is token-shaped and stored as the sha256 of its 32 bytes", async () => {
    expect(isDeviceKeyShaped(DEVICE_KEY)).toBe(true);
    const hash = await deviceKeyHash(DEVICE_KEY);
    expect(hash).toHaveLength(32);
    expect(hash).not.toEqual(await tokenHash(DEVICE_KEY));
    await expect(deviceKeyHash("nope")).rejects.toThrow();
  });

  it("a network is counted under an HMAC of its IP, the same for one IP, never the IP", async () => {
    const key = linkKeyBytes(KEY_BASE64);
    const a = await rateKeyHash(key, "203.0.113.7");
    expect(a).toHaveLength(32);
    expect(await rateKeyHash(key, "203.0.113.7")).toEqual(a);
    expect(await rateKeyHash(key, "203.0.113.8")).not.toEqual(a);
    expect(Buffer.from(a).toString("latin1")).not.toContain("203.0.113.7");
  });

  it("takes the IP from Cloudflare only when it looks like one", () => {
    expect(cleanIp("203.0.113.7")).toBe("203.0.113.7");
    expect(cleanIp("2001:db8::1")).toBe("2001:db8::1");
    expect(cleanIp("999.1.1.1")).toBeNull();
    expect(cleanIp("evil; drop table")).toBeNull();
    expect(cleanIp(null)).toBeNull();
  });
});

describe("UPLOAD_LINK_KEY", () => {
  it("absent or malformed turns the link features off, naming the setting, never its value", () => {
    expect(readLinkKey({})).toMatchObject({ mode: "off" });
    expect(readLinkKey({ UPLOAD_LINK_KEY: "  " })).toMatchObject({ mode: "off" });
    const bad = readLinkKey({ UPLOAD_LINK_KEY: "c2hvcnQ=" });
    expect(bad).toEqual({ mode: "off", reason: "UPLOAD_LINK_KEY must be 32 bytes, base64." });
    expect(readLinkKey({ UPLOAD_LINK_KEY: KEY_BASE64 })).toMatchObject({ mode: "on" });
  });
});

describe("the public API's bodies (plan C7, F2)", () => {
  it("bounds the name and the file, and refuses a malformed MD5", () => {
    expect(registerBodySchema.safeParse({ deviceKey: DEVICE_KEY, name: "Sam" }).success).toBe(true);
    expect(registerBodySchema.safeParse({ deviceKey: "x", name: "Sam" }).success).toBe(false);
    expect(
      startBodySchema.parse({ deviceKey: DEVICE_KEY, name: "a.mp4", sizeBytes: 5 }).relativePath,
    ).toBe("");
    expect(
      startBodySchema.safeParse({ deviceKey: DEVICE_KEY, name: "a", sizeBytes: 6e12 }).success,
    ).toBe(false);
    expect(
      startBodySchema.safeParse({ deviceKey: DEVICE_KEY, name: "a", sizeBytes: 1.5 }).success,
    ).toBe(false);
    const fileId = "11111111-1111-4111-8111-111111111111";
    expect(
      doneBodySchema.safeParse({ deviceKey: DEVICE_KEY, fileId, localMd5: "zz" }).success,
    ).toBe(false);
    expect(
      doneBodySchema.safeParse({ deviceKey: DEVICE_KEY, fileId, localMd5: null }).success,
    ).toBe(true);
  });
});

describe("Google's refusals", () => {
  it("tells the daily upload limit from storage and other 403s", () => {
    expect(isDailyUploadLimit(403, "The user has exceeded their daily upload limit.")).toBe(true);
    expect(isDailyUploadLimit(403, "uploadLimitExceeded")).toBe(true);
    expect(isDailyUploadLimit(403, "The user's Drive storage quota has been exceeded.")).toBe(
      false,
    );
    expect(isDailyUploadLimit(403, "The user does not have sufficient permissions.")).toBe(false);
    expect(isDailyUploadLimit(429, "daily limit")).toBe(false);
  });

  it("names a failed check as the row keeps it, and counts whole seconds", () => {
    expect(failedReasonOf("checksum_mismatch")).toBe("damaged");
    expect(failedReasonOf("size_mismatch")).toBe("size_mismatch");
    expect(failedReasonOf("wrong_folder")).toBe("wrong_folder");
    const now = new Date("2026-11-25T10:00:00Z");
    expect(secondsUntil(new Date("2026-11-25T10:15:00Z"), now)).toBe(900);
    expect(secondsUntil(now, now)).toBe(1);
  });
});

describe("the card and the sheet in the app's words", () => {
  it("shapes the card, never inventing a field the database did not send", () => {
    const card = toUploadCard({
      task_id: "t1",
      state: "active",
      drive_state: "connected",
      task_folder_id: "folder-1",
      link: { id: "l1", sealed: true, created_at: "2026-11-01T00:00:00Z", age_days: 24 },
      files: 3,
      bytes: 3000,
      people: 1,
      uploading: 0,
      uploaders: [
        {
          id: "u1",
          link_id: "l1",
          current_link: true,
          name: "Sam",
          on_task: false,
          files_done: 3,
          bytes_done: 3000,
          bytes_total: 3000,
          last_activity_at: "2026-11-25T09:00:00Z",
          looks_finished: true,
        },
      ],
    });
    expect(card.link).toMatchObject({ id: "l1", sealed: true, ageDays: 24, stopReason: null });
    expect(card.uploaders[0]).toMatchObject({
      name: "Sam",
      onTask: false,
      filesDone: 3,
      filesFailed: 0,
      looksFinished: true,
      stuckSince: null,
    });
  });

  it("keeps the IP and browser out of the sheet unless the database sent them (Q12)", () => {
    const base = {
      uploader: { id: "u1", link_id: "l1", name: "Sam", folder_name: "Sam" },
      files: [{ id: "f1", name: "a.mp4", state: "missing_in_drive", size_bytes: 5 }],
    };
    const sheet = toUploaderSheet(base);
    expect(sheet.uploader).not.toHaveProperty("ip");
    expect(sheet.files[0]).not.toHaveProperty("ip");
    expect(sheet.files[0]?.state).toBe("missing_in_drive");
    const owner = toUploaderSheet({
      uploader: { ...base.uploader, ip: "203.0.113.7", user_agent: "UA" },
      files: [{ ...base.files[0], ip: null, user_agent: null }],
    });
    expect(owner.uploader.ip).toBe("203.0.113.7");
    expect(owner.files[0]).toHaveProperty("ip", null);
  });
});

describe("the network a rate limit counts (plan C1-C2, review pass 2)", () => {
  it("IPv4 as it is; IPv6 by its /64, however it is written", async () => {
    const { rateNetwork } = await import("../domain/api");
    expect(rateNetwork("203.0.113.7")).toBe("203.0.113.7");
    expect(rateNetwork(null)).toBe("unknown");
    expect(rateNetwork("2001:db8:85a3:0:1:2:3:4")).toBe("2001:db8:85a3:0::/64");
    expect(rateNetwork("2001:0DB8:85a3:0000:ffff::1")).toBe("2001:db8:85a3:0::/64");
    expect(rateNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateNetwork("::1")).toBe("0:0:0:0::/64");
  });
});

describe("hasNul (pen test M4)", () => {
  const nul = String.fromCharCode(0);
  it("finds a NUL in any string or key, at any depth", () => {
    expect(hasNul({ name: "Sam" })).toBe(false);
    expect(hasNul({ name: `Sa${nul}m` })).toBe(true);
    expect(hasNul({ [`k${nul}`]: 1 })).toBe(true);
    expect(hasNul([1, [2, [`x${nul}`]]])).toBe(true);
  });
  it("walks a body nested as deep as 64 KB allows without overflowing (review, 26 Nov)", () => {
    const escapedNul = "\\" + "u0000"; // JSON's own escape, as a body carries it
    const deep = JSON.parse(`${"[".repeat(32_000)}"${escapedNul}"${"]".repeat(32_000)}`);
    expect(hasNul(deep)).toBe(true);
    expect(hasNul(JSON.parse(`${"[".repeat(32_000)}${"]".repeat(32_000)}`))).toBe(false);
  });
});
