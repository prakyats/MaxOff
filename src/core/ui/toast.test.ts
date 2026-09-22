import { describe, expect, it } from "vitest";

import { ERROR_MESSAGES } from "@/core/errors";

import { describeError } from "./toast";

describe("describeError", () => {
  it("uses the code's default as the title and the raiser's reason as the description", () => {
    expect(
      describeError({ code: "INVALID_STATE", message: "This task is already completed" }),
    ).toEqual({
      title: ERROR_MESSAGES.INVALID_STATE,
      description: "This task is already completed",
    });
  });

  it("shows only the default when the message is the default", () => {
    expect(describeError({ code: "FORBIDDEN", message: ERROR_MESSAGES.FORBIDDEN })).toEqual({
      title: ERROR_MESSAGES.FORBIDDEN,
    });
  });

  it("summarises field errors when there is nothing more specific to say", () => {
    expect(
      describeError({
        code: "VALIDATION",
        message: ERROR_MESSAGES.VALIDATION,
        fieldErrors: { name: ["Required"], deadline: ["Must be in the future"] },
      }),
    ).toEqual({ title: ERROR_MESSAGES.VALIDATION, description: "2 fields need attention." });
    expect(
      describeError({
        code: "VALIDATION",
        message: "",
        fieldErrors: { name: ["Required"] },
      }).description,
    ).toBe("1 field needs attention.");
  });

  it("never leaks a raw internal message when the code is INTERNAL and the message is empty", () => {
    expect(describeError({ code: "INTERNAL", message: "   " })).toEqual({
      title: ERROR_MESSAGES.INTERNAL,
    });
  });
});
