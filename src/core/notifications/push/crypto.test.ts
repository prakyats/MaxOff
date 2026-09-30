import { describe, expect, it } from "vitest";

import { fromBase64Url, toBase64Url, utf8 } from "./base64url";
import {
  decryptPayload,
  encryptPayload,
  generateReceiverKeys,
  generateVapidKeysForTests,
  MAX_PLAINTEXT_BYTES,
} from "./encrypt";
import { vapidAuthorization, vapidToken, verifyVapidToken } from "./vapid";

/**
 * RFC 8291 Appendix A, "Example Encryption": the published keys, salt and output. Every value
 * below is from the RFC; none is a key anyone uses.
 */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  receiverPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  receiverPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  senderPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  output:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("base64url", () => {
  it("round-trips bytes without padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const text = toBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(fromBase64Url(text)).toEqual(bytes);
    expect(fromBase64Url(RFC.salt)).toHaveLength(16);
    expect(fromBase64Url(RFC.receiverPublic)).toHaveLength(65);
  });
});

describe("encryptPayload (RFC 8291)", () => {
  it("reproduces Appendix A byte for byte", async () => {
    const body = await encryptPayload(
      utf8(RFC.plaintext),
      { p256dh: RFC.receiverPublic, auth: RFC.authSecret },
      {
        senderKeys: { privateKey: RFC.senderPrivate, publicKey: RFC.senderPublic },
        salt: fromBase64Url(RFC.salt),
      },
    );
    expect(toBase64Url(body)).toBe(RFC.output);
  });

  it("is opened by the receiver's key (Appendix A, the other way)", async () => {
    const opened = await decryptPayload(fromBase64Url(RFC.output), {
      privateKey: RFC.receiverPrivate,
      publicKey: RFC.receiverPublic,
      auth: RFC.authSecret,
    });
    expect(new TextDecoder().decode(opened)).toBe(RFC.plaintext);
  });

  it("round-trips with a throwaway subscription and fresh sender keys each time", async () => {
    const receiver = await generateReceiverKeys();
    const keys = { p256dh: receiver.publicKey, auth: receiver.auth };
    const text = JSON.stringify({ title: "New task: Wedding reel", url: "/tasks/1" });
    const one = await encryptPayload(utf8(text), keys);
    const two = await encryptPayload(utf8(text), keys);
    expect(toBase64Url(one)).not.toBe(toBase64Url(two));
    expect(new TextDecoder().decode(await decryptPayload(one, receiver))).toBe(text);
    expect(new TextDecoder().decode(await decryptPayload(two, receiver))).toBe(text);
  });

  it("refuses a payload past one record, a wrong key and a wrong salt", async () => {
    const receiver = await generateReceiverKeys();
    const keys = { p256dh: receiver.publicKey, auth: receiver.auth };
    await expect(encryptPayload(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), keys)).rejects.toThrow(
      /at most/,
    );
    await expect(encryptPayload(utf8("x"), { ...keys, auth: "AAAA" })).rejects.toThrow(/16 bytes/);
    await expect(encryptPayload(utf8("x"), keys, { salt: new Uint8Array(8) })).rejects.toThrow(
      /salt/,
    );
    const other = await generateReceiverKeys();
    const body = await encryptPayload(utf8("secret"), keys);
    await expect(decryptPayload(body, other)).rejects.toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a JWT the public key verifies, for the endpoint's origin, 12 hours long", async () => {
    const pair = await generateVapidKeysForTests();
    const keys = { ...pair, subject: "mailto:owner@example.com" };
    const token = await vapidToken(keys, "https://fcm.googleapis.com/fcm/send/abc", 1_700_000_000);
    const [header, claims] = token.split(".");
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(header!)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims!)))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: 1_700_000_000 + 12 * 3600,
      sub: "mailto:owner@example.com",
    });
    expect(await verifyVapidToken(pair.publicKey, token)).toBe(true);
    const other = await generateVapidKeysForTests();
    expect(await verifyVapidToken(other.publicKey, token)).toBe(false);
    expect(await verifyVapidToken(pair.publicKey, `${token}x`)).toBe(false);
  });

  it("builds the Authorization header with the token and the public key", async () => {
    const pair = await generateVapidKeysForTests();
    const header = await vapidAuthorization(
      { ...pair, subject: "https://app.example" },
      "https://push.example/x",
    );
    expect(header).toMatch(/^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=/);
    expect(header.endsWith(`, k=${pair.publicKey}`)).toBe(true);
  });

  it("refuses a public key that is not an uncompressed point", async () => {
    const pair = await generateVapidKeysForTests();
    await expect(
      vapidToken({ ...pair, publicKey: "AAAA", subject: "mailto:x@y" }, "https://p.example/x"),
    ).rejects.toThrow(/P-256/);
  });
});
