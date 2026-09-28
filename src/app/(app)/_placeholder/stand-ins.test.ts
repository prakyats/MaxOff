import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STAND_INS } from "./stand-ins";

/**
 * The stand-in screens speak to the people using the app, not to the people building it
 * (kickoff 3c amendment (3e)): no task or phase numbers, no build words, short plain lines.
 */
const BUILD_WORDS =
  /\b(task|phase|stage) \d|filled in|module|shell|component|placeholder|roadmap|navigation|built\b|build\b|coming in\b|arrives with/i;

const entries = Object.entries(STAND_INS);

describe("the stand-in copy", () => {
  it.each(entries)("%s names no task numbers and no build words", (_, copy) => {
    for (const text of [copy.description, copy.title, copy.message]) {
      expect(text).not.toMatch(BUILD_WORDS);
      expect(text, "no numbers at all: a date or a task number means nothing here").not.toMatch(
        /\d/,
      );
    }
  });

  it.each(entries)("%s says that it is coming, in a short title", (_, copy) => {
    expect(copy.title).toMatch(/coming soon$/);
    expect(copy.title.length).toBeLessThanOrEqual(40);
  });

  it.each(entries)("%s keeps its lines short and finished", (_, copy) => {
    expect(copy.description).toMatch(/\.$/);
    expect(copy.description.length).toBeLessThanOrEqual(70);
    expect(copy.message).toMatch(/\.$/);
    expect(copy.message.length).toBeLessThanOrEqual(160);
  });

  it("is the only copy the stand-in component shows", () => {
    // The component takes a StandIn and nothing that could carry a task number.
    const source = readFileSync(
      fileURLToPath(new URL("./placeholder-page.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/is filled in|arrives with its module/);
    expect(source).not.toMatch(/\btask\??:/);
  });
});
