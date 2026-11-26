import { describe, expect, it } from "vitest";

import { base32Decode, totpCode } from "../scripts/lib/totp.mjs";

// RFC 6238 Appendix B: the SHA-1 key "12345678901234567890" (base32 below), 8 digits there; the
// same counters give the last 6 digits here.
const RFC_KEY = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totpCode (RFC 6238, v7.5 Q2)", () => {
  it("matches the RFC's SHA-1 vectors (last six digits)", () => {
    expect(totpCode(RFC_KEY, 59_000)).toBe("287082");
    expect(totpCode(RFC_KEY, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(RFC_KEY, 1_234_567_890_000)).toBe("005924");
    expect(totpCode(RFC_KEY, 2_000_000_000_000)).toBe("279037");
  });

  it("holds for one 30-second step and changes with the next", () => {
    expect(totpCode(RFC_KEY, 60_000)).toBe(totpCode(RFC_KEY, 89_999));
    expect(totpCode(RFC_KEY, 90_000)).not.toBe(totpCode(RFC_KEY, 89_999));
  });

  it("reads a key with spaces or lower case, and refuses one that is not base32", () => {
    expect(base32Decode("gezd gnbv").equals(base32Decode("GEZDGNBV"))).toBe(true);
    expect(() => base32Decode("not-base32!")).toThrow("not a base32 key");
  });
});
