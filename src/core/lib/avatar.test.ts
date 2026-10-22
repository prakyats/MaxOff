import { describe, expect, it } from "vitest";

import { AVATAR_TONES, avatarInitials, avatarStack, avatarTone, avatarVariant } from "./avatar";

describe("avatarInitials", () => {
  it("takes the first and last word's first letters", () => {
    expect(avatarInitials("Prishit Shetty")).toBe("PS");
    expect(avatarInitials("Anna Maria Kurian")).toBe("AK");
    expect(avatarInitials("  ravi   kumar ")).toBe("RK");
  });

  it("takes a one-word name's first two letters", () => {
    expect(avatarInitials("Prakyat")).toBe("PR");
    expect(avatarInitials("A")).toBe("A");
  });

  it("answers ? for an empty name and keeps a letter outside the BMP whole", () => {
    expect(avatarInitials("   ")).toBe("?");
    expect(avatarInitials("𝒜da Lovelace")).toBe("𝒜L");
  });
});

describe("avatarTone", () => {
  it("is stable for the same person", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(avatarTone(id)).toBe(avatarTone(id));
  });

  it("is always one of the four tones", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(AVATAR_TONES).toContain(avatarTone(`member-${index}`));
    }
  });

  it("spreads people over all four tones", () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, index) =>
        avatarTone(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
      ),
    );
    expect(seen.size).toBe(4);
  });
});

describe("avatarVariant", () => {
  it("loads the 96 px thumbnail in lists and the preview only at 64 px", () => {
    expect(avatarVariant(20)).toBe("thumb");
    expect(avatarVariant(28)).toBe("thumb");
    expect(avatarVariant(40)).toBe("thumb");
    expect(avatarVariant(64)).toBe("preview");
  });
});

describe("avatarStack", () => {
  it("shows up to three faces, then +n", () => {
    expect(avatarStack(["a", "b"])).toEqual({ shown: ["a", "b"], more: 0 });
    expect(avatarStack(["a", "b", "c"])).toEqual({ shown: ["a", "b", "c"], more: 0 });
    expect(avatarStack(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], more: 2 });
  });
});
