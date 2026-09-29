import { describe, expect, it } from "vitest";

import { hasLink, linkSegments, safeHref } from "../domain/links";

describe("links in a Done note (kickoff 4 decision 10)", () => {
  it("splits a note into text and http/https links", () => {
    expect(
      linkSegments("Final cut: https://drive.google.com/file/d/abc/view please check"),
    ).toEqual([
      { kind: "text", text: "Final cut: " },
      {
        kind: "link",
        text: "https://drive.google.com/file/d/abc/view",
        href: "https://drive.google.com/file/d/abc/view",
      },
      { kind: "text", text: " please check" },
    ]);
  });

  it("leaves sentence punctuation and an unmatched bracket out of the link", () => {
    const segments = linkSegments("See (https://example.com/a_(b)) and http://example.org.");
    expect(segments.filter((s) => s.kind === "link").map((s) => s.text)).toEqual([
      "https://example.com/a_(b)",
      "http://example.org",
    ]);
    expect(segments.at(-1)).toEqual({ kind: "text", text: "." });
  });

  it("never makes a link of another scheme, and keeps markup as plain text", () => {
    const text = 'javascript:alert(1) <a href="https://x.test">x</a> data:text/html,hi';
    const segments = linkSegments(text);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    // The quote ends the candidate, so the address inside the tag is still only an address.
    expect(segments.filter((s) => s.kind === "link").map((s) => s.href)).toEqual([
      "https://x.test/",
    ]);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("ftp://example.com")).toBeNull();
    expect(safeHref("https://")).toBeNull();
  });

  it("knows whether a note carries a link", () => {
    expect(hasLink("Done, see https://drive.google.com/x")).toBe(true);
    expect(hasLink("Done, sent on WhatsApp")).toBe(false);
    expect(hasLink(null)).toBe(false);
  });

  it("keeps every character of the text, in order", () => {
    const text = "a https://a.test/1, b http://b.test/2) c";
    expect(
      linkSegments(text)
        .map((s) => s.text)
        .join(""),
    ).toBe(text);
  });
});
