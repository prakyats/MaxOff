import { describe, expect, it } from "vitest";

import { rscRequestKind } from "../e2e/rsc-request";

/**
 * The RSC request classifier (`e2e/rsc-request.ts`): a re-read of the screen (`router.refresh()`,
 * the root marked `refetch`) against a move's or Next's own follow-up request for the segments it
 * lacks (a segment below the root marked). The trees are the real headers of a move to `/leave`
 * and a refresh on it (Next 16.3.5, 26 Nov 2026).
 */
const encode = (tree: unknown) => encodeURIComponent(JSON.stringify(tree));
const page = ["__PAGE__", {}, null, null, 4096];
const leaveTree = (marks: { root?: boolean; app?: boolean; leave?: boolean }) => [
  "",
  {
    children: [
      "(app)",
      {
        children: [
          "leave",
          { children: ["(leave)", { children: page }, null, null, 4100] },
          null,
          marks.leave ? "refetch" : null,
          4104,
        ],
      },
      null,
      marks.app ? "refetch" : null,
      4108,
    ],
  },
  null,
  marks.root ? "refetch" : null,
  4120,
];

describe("rscRequestKind", () => {
  it("a refresh marks the root: a re-read", () => {
    expect(rscRequestKind(encode(leaveTree({ root: true })))).toBe("refresh");
    // Next's DynamicRequestTreeForEntireRoute.
    expect(rscRequestKind(encode(["", {}, null, "refetch"]))).toBe("refresh");
  });

  it("a move's own request marks a segment below the root: not a re-read", () => {
    expect(rscRequestKind(encode(leaveTree({ leave: true })))).toBe("partial");
  });

  it("Next's follow-up for a committed move's dynamic data marks below the root: not a re-read", () => {
    expect(rscRequestKind(encode(leaveTree({ app: true })))).toBe("partial");
  });

  it("nothing marked is a plain request", () => {
    expect(rscRequestKind(encode(leaveTree({})))).toBe("plain");
  });

  it("the root marked wins over a mark below it", () => {
    expect(rscRequestKind(encode(leaveTree({ root: true, leave: true })))).toBe("refresh");
  });

  it("no header, or one that is not a tree, is unknown", () => {
    expect(rscRequestKind(undefined)).toBeNull();
    expect(rscRequestKind("%7Bnot-json")).toBeNull();
    expect(rscRequestKind(encode({ not: "a tree" }))).toBeNull();
  });
});
