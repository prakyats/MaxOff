import { describe, expect, it } from "vitest";

import { SPACE_GUARD, spaceGuard, spaceOverrideNote } from "../domain/space";

describe("the upload space guard (S7)", () => {
  it("the decided rule is a 10 GB step and a 10 GB reserve", () => {
    expect(SPACE_GUARD).toEqual({ stepBytes: 10e9, reserveBytes: 10e9 });
  });
  it("unset (production) is the decided rule", () => {
    expect(spaceGuard({})).toEqual({ stepBytes: 10e9, reserveBytes: 10e9 });
  });
  it("staging's test override: whole numbers only, a step of at least 1 GB", () => {
    expect(
      spaceGuard({ UPLOAD_SPACE_STEP_BYTES: "1000000000", UPLOAD_SPACE_RESERVE_BYTES: "0" }),
    ).toEqual({ stepBytes: 1e9, reserveBytes: 0 });
    expect(spaceGuard({ UPLOAD_SPACE_STEP_BYTES: "5" })).toEqual({
      stepBytes: 1e9,
      reserveBytes: 10e9,
    });
    for (const bad of ["", " ", "-1", "1e9", "ten", "1.5"]) {
      expect(spaceGuard({ UPLOAD_SPACE_STEP_BYTES: bad, UPLOAD_SPACE_RESERVE_BYTES: bad })).toEqual(
        { stepBytes: 10e9, reserveBytes: 10e9 },
      );
    }
  });
  it("production ignores any override (review pass 2)", () => {
    expect(
      spaceGuard({
        NEXT_PUBLIC_APP_ENV: "production",
        UPLOAD_SPACE_STEP_BYTES: "1000000000",
        UPLOAD_SPACE_RESERVE_BYTES: "0",
      }),
    ).toEqual({ stepBytes: 10e9, reserveBytes: 10e9 });
  });
  it("says so once when the override is active, and nothing under the decided rule", () => {
    expect(spaceOverrideNote({})).toBeNull();
    expect(
      spaceOverrideNote({
        UPLOAD_SPACE_STEP_BYTES: "10000000000",
        UPLOAD_SPACE_RESERVE_BYTES: "10000000000",
      }),
    ).toBeNull();
    expect(
      spaceOverrideNote({ UPLOAD_SPACE_STEP_BYTES: "1000000000", UPLOAD_SPACE_RESERVE_BYTES: "0" }),
    ).toBe(
      "[uploads] the space guard's TEST override is active (staging only): a 1000000000-byte step and a 0-byte reserve, not the decided 10 GB / 10 GB.",
    );
  });
});
