import { describe, expect, it } from "vitest";

import { formatRupees } from "./rupees";

describe("formatRupees", () => {
  it("keeps whole rupees whole and shows paise with two digits, Indian grouping", () => {
    expect(formatRupees(1200)).toBe("₹1,200");
    expect(formatRupees(42.5)).toBe("₹42.50");
    expect(formatRupees(150000)).toBe("₹1,50,000");
  });

  it("reads zero and lakhs of rupees the Indian way", () => {
    expect(formatRupees(0)).toBe("₹0");
    expect(formatRupees(1250000)).toBe("₹12,50,000");
    expect(formatRupees(99.05)).toBe("₹99.05");
  });
});
