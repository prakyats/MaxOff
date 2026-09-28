import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./service", () => ({ createServiceSupabase: () => fake({ error: null }) }));

import { databaseReachable } from "./health";

type Answer = { error: null | { message: string } };

/** A client whose `from().select().abortSignal()` answers as told, or hangs until aborted. */
function fake(answer: Answer | "hang") {
  return {
    from: () => ({
      select: () => ({
        abortSignal: (signal: AbortSignal) =>
          answer === "hang"
            ? new Promise<Answer>((_, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")));
              })
            : Promise.resolve(answer),
      }),
    }),
  };
}

describe("databaseReachable (3c.1)", () => {
  it("is true when the count query answers without an error", async () => {
    expect(await databaseReachable(fake({ error: null }))).toBe(true);
  });

  it("is false on a query error", async () => {
    expect(await databaseReachable(fake({ error: { message: "connection refused" } }))).toBe(false);
  });

  it("is false when the database does not answer in time, and never throws", async () => {
    expect(await databaseReachable(fake("hang"), 20)).toBe(false);
  });

  it("uses the service client by default", async () => {
    expect(await databaseReachable()).toBe(true);
  });
});
