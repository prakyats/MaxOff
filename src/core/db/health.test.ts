import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./service", () => ({ createServiceSupabase: vi.fn(() => fake({ error: null })) }));

import { databaseReachable } from "./health";
import { createServiceSupabase } from "./service";

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

  it("is false, not a throw, when the service client cannot be created (no SUPABASE_SECRET_KEY)", async () => {
    vi.mocked(createServiceSupabase).mockImplementationOnce(() => {
      throw new Error("SUPABASE_SECRET_KEY is not set");
    });
    expect(await databaseReachable()).toBe(false);
  });
});
