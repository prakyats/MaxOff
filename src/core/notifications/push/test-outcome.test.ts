import { describe, expect, it } from "vitest";

import { testOutcome } from "./test-outcome";

describe("testOutcome: what Send a test says, and whether to ask Did it arrive (5.5)", () => {
  it("accepted by a push service: delivered", () => {
    expect(testOutcome({ accepted: 1, devices: 1, pushOff: false })).toEqual({
      text: "Sent to 1 device",
      delivered: true,
    });
    expect(testOutcome({ accepted: 2, devices: 3, pushOff: false })).toEqual({
      text: "Sent to 2 devices",
      delivered: true,
    });
  });
  it("nothing accepted, no device, or push off: not delivered", () => {
    expect(testOutcome({ accepted: 0, devices: 2, pushOff: false }).delivered).toBe(false);
    expect(testOutcome({ accepted: 0, devices: 0, pushOff: false }).text).toBe(
      "No device is turned on yet.",
    );
    expect(testOutcome({ accepted: 0, devices: 1, pushOff: true }).text).toBe(
      "Push is not set up on the server yet: nothing was sent.",
    );
  });
});
