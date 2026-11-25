import { describe, expect, it } from "vitest";

import {
  cleanUploaderName,
  deriveLinkToken,
  isTokenShaped,
  linkKeyBytes,
  matchAssignee,
  nameKey,
  newLinkSalt,
  tokenHash,
  uploaderFolderName,
  uploaderSignal,
} from "..";

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i)));
const OTHER = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 99 - i)));

describe("the link token", () => {
  it("is 43 url-safe characters, the same every time for one link, different per link and key", async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
    const key = linkKeyBytes(KEY);
    const a = await deriveLinkToken({ key, linkId: "link-1", salt });
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isTokenShaped(a)).toBe(true);
    expect(await deriveLinkToken({ key, linkId: "link-1", salt })).toBe(a);
    expect(await deriveLinkToken({ key, linkId: "link-2", salt })).not.toBe(a);
    expect(await deriveLinkToken({ key, linkId: "link-1", salt: newLinkSalt() })).not.toBe(a);
    expect(await deriveLinkToken({ key: linkKeyBytes(OTHER), linkId: "link-1", salt })).not.toBe(a);
  });

  it("is stored only as its sha256, 32 bytes", async () => {
    const token = await deriveLinkToken({
      key: linkKeyBytes(KEY),
      linkId: "l",
      salt: newLinkSalt(),
    });
    const hash = await tokenHash(token);
    expect(hash).toHaveLength(32);
    expect(Buffer.from(hash).toString("base64url")).not.toBe(token);
  });

  it("refuses a key that is not 32 bytes, and text that is not token-shaped", () => {
    expect(() => linkKeyBytes("c2hvcnQ=")).toThrow("32 bytes");
    expect(() => linkKeyBytes("%%%")).toThrow();
    expect(isTokenShaped("short")).toBe(false);
    expect(isTokenShaped(`${"a".repeat(42)}+`)).toBe(false);
    expect(isTokenShaped("a".repeat(44))).toBe(false);
  });
});

describe("the uploader's name", () => {
  it("is trimmed, NFC, without hidden or bidi characters, 1–60 characters", () => {
    expect(cleanUploaderName("  Sam   Patel ")).toEqual({ ok: true, name: "Sam Patel" });
    expect(cleanUploaderName("Sa​m‮")).toEqual({ ok: true, name: "Sam" });
    expect(cleanUploaderName("José")).toEqual({ ok: true, name: "José" });
    expect(cleanUploaderName(" ​ ")).toEqual({ ok: false, reason: "empty" });
    expect(cleanUploaderName("x".repeat(61))).toEqual({ ok: false, reason: "too_long" });
    expect(cleanUploaderName("😀".repeat(60)).ok).toBe(true);
    // Also stripped: soft hyphen, line / paragraph separators, U+180E, U+034F, variation selectors.
    expect(cleanUploaderName("S\u00ADa\u2028m\u2029\u180E\u034F\uFE0F")).toEqual({
      ok: true,
      name: "Sam",
    });
    // Only combining marks: nothing left to match, so empty (not a database error).
    expect(cleanUploaderName("\u0301\u0301")).toEqual({ ok: false, reason: "empty" });
  });

  it("matches an assignee by full or first name, ignoring case and accents", () => {
    const people = [
      { id: "a", fullName: "José Martin" },
      { id: "b", fullName: "Asha Rao" },
    ];
    expect(matchAssignee("jose", people)).toBe("a");
    expect(matchAssignee("JOSÉ MARTIN", people)).toBe("a");
    expect(matchAssignee("asha  rao", people)).toBe("b");
    expect(matchAssignee("Rao", people)).toBeNull();
    expect(matchAssignee("Alex", people)).toBeNull();
    expect(nameKey("  Émile  Zola ")).toBe("emile zola");
  });

  it("gets its own folder, or 'Sam (2)' when the name is taken on the link", () => {
    expect(uploaderFolderName("Sam", [])).toBe("Sam");
    expect(uploaderFolderName("sam", ["Sam"])).toBe("sam (2)");
    expect(uploaderFolderName("Sam", ["Sam", "Sam (2)"])).toBe("Sam (3)");
    // Never beside a hand-in version folder (v5.0).
    expect(uploaderFolderName("v2", [])).toBe("v2 (2)");
    expect(uploaderFolderName("V10", ["V10 (2)"])).toBe("V10 (3)");
    expect(uploaderFolderName("v2a", [])).toBe("v2a");
  });
});

describe("the Admin's signals", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it("stuck after 15 minutes with work left and no progress", () => {
    const files = [{ state: "done" as const }, { state: "uploading" as const }];
    expect(
      uploaderSignal({ files, lastProgressAt: ago(14), saidDone: false, linkStopped: false }, now),
    ).toBeNull();
    expect(
      uploaderSignal({ files, lastProgressAt: ago(15), saidDone: false, linkStopped: false }, now),
    ).toBe("stuck");
  });

  it("looks finished after 10 quiet minutes with every file done, unless they said I'm done", () => {
    const files = [{ state: "done" as const }];
    expect(
      uploaderSignal({ files, lastProgressAt: ago(9), saidDone: false, linkStopped: false }, now),
    ).toBeNull();
    expect(
      uploaderSignal({ files, lastProgressAt: ago(10), saidDone: false, linkStopped: false }, now),
    ).toBe("looks_finished");
    expect(
      uploaderSignal({ files, lastProgressAt: ago(60), saidDone: true, linkStopped: false }, now),
    ).toBeNull();
  });

  it("nothing once the link has stopped, or before any file", () => {
    const files = [{ state: "uploading" as const }];
    expect(
      uploaderSignal({ files, lastProgressAt: ago(60), saidDone: false, linkStopped: true }, now),
    ).toBeNull();
    expect(
      uploaderSignal(
        { files: [], lastProgressAt: ago(60), saidDone: false, linkStopped: false },
        now,
      ),
    ).toBeNull();
  });
});
