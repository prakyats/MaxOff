import { describe, expect, it } from "vitest";

import { sameOrigin } from "./origin";

const REQUEST = "https://maxoff.example/api/approvals/approve";

describe("sameOrigin", () => {
  it("accepts the app's own origin", () => {
    expect(sameOrigin("https://maxoff.example", REQUEST)).toBe(true);
  });

  it("refuses another host", () => {
    expect(sameOrigin("https://evil.example", REQUEST)).toBe(false);
    expect(sameOrigin("https://maxoff.example.evil.example", REQUEST)).toBe(false);
  });

  it("refuses a missing, null or unparsable header without throwing", () => {
    expect(sameOrigin(null, REQUEST)).toBe(false);
    expect(sameOrigin("null", REQUEST)).toBe(false);
    expect(sameOrigin("not a url", REQUEST)).toBe(false);
    expect(sameOrigin("", REQUEST)).toBe(false);
  });
});
