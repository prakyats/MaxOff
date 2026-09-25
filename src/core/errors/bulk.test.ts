import { describe, expect, it } from "vitest";

import { AppError } from "./app-error";
import { bulkSummary } from "./bulk";
import { eachId } from "./each-id";

describe("eachId", () => {
  it("runs every id in order, one after another, and reports each", async () => {
    const seen: string[] = [];
    let running = 0;
    const outcome = await eachId(["a", "b", "c"], async (id) => {
      running += 1;
      expect(running).toBe(1);
      seen.push(id);
      await Promise.resolve();
      running -= 1;
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(outcome).toEqual({ done: ["a", "b", "c"], failed: [] });
  });

  it("keeps going after a failure and names the row with its own message", async () => {
    const outcome = await eachId(["a", "b", "c"], async (id) => {
      if (id === "b") {
        throw {
          code: "P0001",
          message: "CONFLICT",
          details: "Approved leave (Leave, 12 Oct) already covers these dates.",
        };
      }
      if (id === "c") throw new AppError("INVALID_STATE", "This request has already been decided.");
    });
    expect(outcome.done).toEqual(["a"]);
    expect(outcome.failed).toEqual([
      {
        id: "b",
        code: "CONFLICT",
        message: "Approved leave (Leave, 12 Oct) already covers these dates.",
      },
      { id: "c", code: "INVALID_STATE", message: "This request has already been decided." },
    ]);
  });
});

describe("bulkSummary", () => {
  it("says what happened in a few words", () => {
    expect(bulkSummary({ done: ["a", "b"], failed: [] }, "approved")).toBe("2 approved");
    expect(
      bulkSummary(
        { done: ["a"], failed: [{ id: "b", code: "CONFLICT", message: "x" }] },
        "approved",
      ),
    ).toBe("1 approved · 1 needs review");
    expect(
      bulkSummary(
        {
          done: [],
          failed: [
            { id: "a", code: "CONFLICT", message: "x" },
            { id: "b", code: "CONFLICT", message: "y" },
          ],
        },
        "approved",
      ),
    ).toBe("2 need review");
    expect(bulkSummary({ done: [], failed: [] }, "approved")).toBe("Nothing changed");
  });
});
