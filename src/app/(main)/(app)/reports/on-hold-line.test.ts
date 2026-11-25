import { describe, expect, it } from "vitest";

import { onHoldHref } from "./on-hold-href";

describe('"On hold · n deliverables" (v1.9 W8)', () => {
  it("opens the one held project, or the deliverables list on On hold", () => {
    const one = { clientId: "c", projectId: "p", deliverables: 3 };
    expect(onHoldHref([one])).toBe("/clients/c/projects/p");
    expect(onHoldHref([one, { ...one, projectId: "q" }])).toBe("/clients/items?filter=on_hold");
    expect(onHoldHref([])).toBe("/clients/items?filter=on_hold");
  });
});
