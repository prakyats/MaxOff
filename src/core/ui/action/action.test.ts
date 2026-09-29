import { describe, expect, it } from "vitest";

import { isNetworkError } from "./network-error";
import { workingLabel } from "./working-label";

describe("workingLabel", () => {
  it.each([
    ["Save", "Saving…"],
    ["Save changes", "Saving changes…"],
    ["Approve 3", "Approving 3…"],
    ["Deactivate Ravi", "Deactivating Ravi…"],
    ["Reject request", "Rejecting request…"],
    ["Cancel leave", "Cancelling leave…"],
    ["Log out", "Logging out…"],
    ["Withdraw request", "Withdrawing request…"],
    ["Send invite", "Sending invite…"],
    ["Start day", "Starting day…"],
    ["Submit", "Submitting…"],
    ["Remove Diwali", "Removing Diwali…"],
    ["Agree", "Agreeing…"],
    ["", "Working…"],
    ["I'm working today", "Working…"],
    ["3 left", "Working…"],
  ])("%s → %s", (label, expected) => {
    expect(workingLabel(label)).toBe(expected);
  });
});

describe("isNetworkError", () => {
  it("recognises every browser's failed fetch and a gateway's page", () => {
    for (const message of [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
      "An unexpected response was received from the server.",
    ]) {
      expect(isNetworkError(new TypeError(message))).toBe(true);
    }
  });

  it("leaves real errors to the error boundary", () => {
    expect(isNetworkError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isNetworkError("Failed to fetch")).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});
