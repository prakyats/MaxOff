import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ answer: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    rpc: async () => ({ data: fake.answer, error: null }),
  }),
}));

import { boardPart } from "../data/board";

/**
 * The Owner's Today board fold (v2.0 X3, `attendance_board_today()`; X5+ M5): a part, or the
 * refusal its own function would have raised, with that function's code.
 */
describe("boardPart", () => {
  it("the part's rows", async () => {
    fake.answer = { people: [{ member_id: "m1" }], hours: [], refused: null };
    expect(await boardPart("people")).toEqual([{ member_id: "m1" }]);
    expect(await boardPart("hours")).toEqual([]);
  });

  it("refused: the fold's own code (FORBIDDEN or UNAUTHENTICATED)", async () => {
    for (const code of ["FORBIDDEN", "UNAUTHENTICATED"]) {
      fake.answer = { people: null, hours: null, refused: code };
      await expect(boardPart("people")).rejects.toThrow(code);
      await expect(boardPart("hours")).rejects.toThrow(code);
    }
  });

  it("a part missing without a code: FORBIDDEN, never an empty board", async () => {
    fake.answer = { people: null, hours: [], refused: null };
    await expect(boardPart("people")).rejects.toThrow("FORBIDDEN");
  });
});
