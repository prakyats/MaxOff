import { describe, expect, it } from "vitest";

import {
  historyFreshness,
  noteHistoryMove,
  onHistoryMove,
  RESTORED_MAX_AGE_MS,
  restoredNeedsRefresh,
} from "./history-freshness";
import { actionEmptiesCaches } from "./progress";

describe("a screen shown again by back or forward (6b.17a)", () => {
  it("is re-read once it is as old as refresh on return's interval", () => {
    expect(RESTORED_MAX_AGE_MS).toBe(30_000);
    const needs = (now: number) =>
      restoredNeedsRefresh({ now, drawnAt: 1_000, emptiedAt: Number.NEGATIVE_INFINITY });
    expect(needs(1_000 + RESTORED_MAX_AGE_MS)).toBe(true);
    expect(needs(1_000 + 10 * 60_000)).toBe(true);
  });

  it("comes back from the cache as it is when younger than that", () => {
    expect(restoredNeedsRefresh({ now: 30_999, drawnAt: 1_000, emptiedAt: 0 })).toBe(false);
  });

  it("is left to the router when its caches were emptied after it was drawn", () => {
    expect(restoredNeedsRefresh({ now: 600_000, drawnAt: 1_000, emptiedAt: 2_000 })).toBe(false);
  });

  it("counts as cached when it was drawn by the refresh that emptied the caches", () => {
    expect(restoredNeedsRefresh({ now: 600_000, drawnAt: 2_000, emptiedAt: 2_000 })).toBe(true);
  });
});

describe("the page's record", () => {
  it("keeps each address's last fetch, and the page's own drawing for the rest", () => {
    const record = historyFreshness(500);
    expect(record.drawnAt("/tasks")).toBe(500);
    record.fetched("/tasks", 2_000);
    record.fetched("/tasks", 3_000);
    expect(record.drawnAt("/tasks")).toBe(3_000);
    expect(record.drawnAt("/tasks?tab=chat")).toBe(500);
  });

  it("keeps the latest emptying", () => {
    const record = historyFreshness(0);
    expect(record.emptiedAt()).toBe(Number.NEGATIVE_INFINITY);
    record.emptied(4_000);
    record.emptied(3_000);
    expect(record.emptiedAt()).toBe(4_000);
  });

  it("tells each listener of a back or forward until it stops listening", () => {
    const heard: string[] = [];
    const stop = onHistoryMove((path) => heard.push(path));
    noteHistoryMove("/tasks");
    stop();
    noteHistoryMove("/today");
    expect(heard).toEqual(["/tasks"]);
  });
});

describe("a server action's answer", () => {
  const answer = (headers: Record<string, string>) => new Headers(headers);

  it("empties the router's caches when it revalidated", () => {
    expect(actionEmptiesCaches(answer({ "x-action-revalidated": "1" }))).toBe(true);
    expect(actionEmptiesCaches(answer({ "x-action-revalidated": "2" }))).toBe(true);
  });

  it("empties nothing without a revalidation, a redirect included", () => {
    expect(actionEmptiesCaches(answer({}))).toBe(false);
    expect(actionEmptiesCaches(answer({ "x-action-revalidated": "0" }))).toBe(false);
    expect(actionEmptiesCaches(answer({ "x-action-redirect": "/today" }))).toBe(false);
  });
});
