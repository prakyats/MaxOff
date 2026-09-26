import { describe, expect, it } from "vitest";

import { checkBudgets, firstLoadFiles } from "../scripts/lib/first-load.mjs";

/** The first-load JS budget (task 2.8): what `pnpm budget` counts and when it fails. */
describe("firstLoadFiles", () => {
  it("is the root main files plus every segment's chunks, once each, JS only", () => {
    const files = firstLoadFiles({
      rootMainFiles: ["static/chunks/react.js", "static/chunks/turbopack.js"],
      entryJSFiles: {
        "[project]/src/app/layout": ["static/chunks/root.js"],
        "[project]/src/app/(app)/layout": ["static/chunks/root.js", "static/chunks/shell.js"],
        "[project]/src/app/(app)/today/page": ["static/chunks/today.js", "static/css/today.css"],
      },
    });
    expect(files).toEqual([
      "static/chunks/react.js",
      "static/chunks/root.js",
      "static/chunks/shell.js",
      "static/chunks/today.js",
      "static/chunks/turbopack.js",
    ]);
  });
});

describe("checkBudgets", () => {
  it("passes a route at or under its budget and fails one over it", () => {
    expect(
      checkBudgets({ "/login": 500, "/today": 801 }, { "/login": 500, "/today": 800 }),
    ).toEqual([
      { route: "/login", bytes: 500, budget: 500, ok: true },
      { route: "/today", bytes: 801, budget: 800, ok: false },
    ]);
  });

  it("fails a budgeted route the build no longer has, so a rename cannot slip out", () => {
    expect(checkBudgets({}, { "/today": 800 })).toEqual([
      { route: "/today", bytes: undefined, budget: 800, ok: false },
    ]);
  });
});
