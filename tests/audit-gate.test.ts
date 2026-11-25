import { describe, expect, it } from "vitest";

import { advisoriesOf, gate, summary } from "../scripts/lib/audit-gate.mjs";

/** The dependency-audit gate (v7.5 plan §2.1): what fails `pnpm audit:gate`. */
const advisory = (id: string, severity: string, module = "next") => ({
  id,
  module,
  severity,
  title: `Title ${id}`,
  patched: ">=1.0.1",
  url: `https://github.com/advisories/${id}`,
});

describe("gate", () => {
  it("fails on a critical advisory the allowlist does not name, never on a high one", () => {
    const result = gate(
      [advisory("GHSA-a", "critical"), advisory("GHSA-b", "high")],
      [],
      "2026-11-26",
    );
    expect(result.ok).toBe(false);
    expect(result.failing.map((a) => a.id)).toEqual(["GHSA-a"]);
  });

  it("lets an allowlisted critical through until its expiry, then fails", () => {
    const allowlist = [{ id: "GHSA-a", module: "next", expires: "2026-12-10", reason: "v2.0.1" }];
    expect(gate([advisory("GHSA-a", "critical")], allowlist, "2026-12-10").ok).toBe(true);
    const late = gate([advisory("GHSA-a", "critical")], allowlist, "2026-12-11");
    expect(late.ok).toBe(false);
    expect(late.expired.map((entry) => entry.id)).toEqual(["GHSA-a"]);
  });

  it("reports an entry that no longer matches anything, without failing", () => {
    const allowlist = [{ id: "GHSA-gone", module: "next", expires: "2026-12-10", reason: "fixed" }];
    const result = gate([], allowlist, "2026-11-26");
    expect(result.ok).toBe(true);
    expect(result.stale.map((entry) => entry.id)).toEqual(["GHSA-gone"]);
  });
});

describe("advisoriesOf and summary", () => {
  it("reads pnpm audit's JSON and lists high and critical, critical first", () => {
    const report = {
      advisories: {
        "1": {
          github_advisory_id: "GHSA-h",
          module_name: "zod",
          severity: "high",
          title: "T",
          patched_versions: ">=4.6.6",
          url: "u",
        },
        "2": {
          github_advisory_id: "GHSA-c",
          module_name: "next",
          severity: "critical",
          title: "T",
          patched_versions: ">=16.4.1",
          url: "u",
        },
        "3": {
          github_advisory_id: "GHSA-m",
          module_name: "x",
          severity: "moderate",
          title: "T",
          patched_versions: ">=1",
          url: "u",
        },
      },
    };
    const advisories = advisoriesOf(report);
    expect(advisories).toHaveLength(3);
    const text = summary(advisories, [], "2026-11-26");
    expect(text).toContain("2 high or critical");
    expect(text.indexOf("GHSA-c")).toBeLessThan(text.indexOf("GHSA-h"));
    expect(text).not.toContain("GHSA-m");
  });
});
