import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LoadingState, type LoadingShape } from "./loading-state";
import { CARD_ROW_MIN_H, CARD_ROW_PADDING, LIST_ROW_MIN_H } from "./row-metrics";

/**
 * ARCHITECTURE §14.1: "a skeleton traces the screen it replaces". These tests hold the two
 * halves of that promise — each shape draws its own structure, and the card skeleton keeps the
 * same row geometry as a real `DataTable` card, so nothing moves when the data arrives.
 *
 * Rendered with `react-dom/server` rather than a DOM testing library: these are pure
 * presentational components with no state or effects, so static markup is the whole story and
 * the repo needs no jsdom.
 */
const html = (shape: LoadingShape, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<LoadingState shape={shape} {...props} />);

const dataTableSource = readFileSync(
  fileURLToPath(new URL("./data-table.tsx", import.meta.url)),
  "utf8",
);

describe("LoadingState shapes", () => {
  it("tags the rendered skeleton with the shape it was asked for", () => {
    for (const shape of ["list", "cards", "tiles", "detail", "table"] as const) {
      expect(html(shape)).toContain(`data-shape="${shape}"`);
    }
  });

  it("gives every shape its own structure", () => {
    // The bug this prevents: Tasks (cards) showing People's avatar list.
    const markup = Object.fromEntries(
      (["list", "cards", "tiles", "detail", "table"] as const).map((shape) => [shape, html(shape)]),
    );
    expect(new Set(Object.values(markup)).size).toBe(5);

    expect(markup.tiles).toContain('data-slot="loading-tile"');
    expect(markup.tiles).toContain("grid");
    expect(markup.detail).toContain('data-slot="loading-field"');
    expect(markup.cards).toContain(CARD_ROW_MIN_H);
    expect(markup.list).toContain(LIST_ROW_MIN_H);

    // Only `detail` draws an avatar circle. No list shape may borrow one again.
    expect(markup.detail).toContain("rounded-full");
    expect(markup.cards).not.toContain("size-12");
    expect(markup.tiles).not.toContain("rounded-full");
  });

  it("renders three to five items, never a screenful", () => {
    for (const shape of ["list", "cards", "tiles", "detail", "table"] as const) {
      const rows = html(shape).match(/data-slot="skeleton"/g)?.length ?? 0;
      expect(rows, shape).toBeGreaterThanOrEqual(3);
      expect(rows, shape).toBeLessThanOrEqual(24);
    }
    const four = html("cards", { count: 4 }).match(/data-slot="loading-row"/g)?.length;
    expect(four).toBe(4);
  });

  it("draws trailing actions only where a row really has them", () => {
    const withActions = html("list", { count: 1, actions: 2 });
    const without = html("list", { count: 1 });
    const count = (markup: string) => (markup.match(/h-8 w-16/g) ?? []).length;
    expect(count(withActions)).toBe(2);
    expect(count(without)).toBe(0);
  });

  it("announces itself to a screen reader as busy", () => {
    const markup = html("cards", { label: "Loading Tasks" });
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Loading Tasks");
  });
});

describe("the card skeleton traces a real card", () => {
  it("uses the same row height and padding constants as DataTable", () => {
    const markup = html("cards");
    expect(markup).toContain(CARD_ROW_MIN_H);
    expect(markup).toContain(CARD_ROW_PADDING);
  });

  it("keeps DataTable reading those constants rather than hardcoding a height", () => {
    // If someone inlines `min-h-16` back into the real card, the two can drift silently.
    expect(dataTableSource).toContain('from "./row-metrics"');
    expect(dataTableSource).toContain("CARD_ROW_MIN_H");
    expect(dataTableSource).toContain("CARD_ROW_PADDING");
    expect(dataTableSource).not.toMatch(/className="[^"]*\bmin-h-16\b/);
  });
});

describe("reduced motion", () => {
  it("shimmers only when motion is allowed", () => {
    const skeleton = readFileSync(
      fileURLToPath(new URL("../primitives/skeleton.tsx", import.meta.url)),
      "utf8",
    );
    expect(skeleton).toContain("motion-safe:animate-pulse");
    expect(skeleton).not.toMatch(/(?<!motion-safe:)\banimate-pulse\b/);
  });
});
