import { describe, expect, it } from "vitest";

import {
  needsSecondStep,
  offersSecondStep,
  ownerSecondStepRequired,
  totpSwitchedOff,
} from "./second-step";

describe("needsSecondStep (v7.5 Q2)", () => {
  const base = { secondStep: false, aal: "aal1", ownerRequired: true } as const;

  it("the Owner must, while the environment requires it", () => {
    expect(needsSecondStep({ ...base, role: "owner" })).toBe(true);
    expect(needsSecondStep({ ...base, role: "owner", ownerRequired: false })).toBe(false);
  });

  it("anyone who turned it on must, the Owner included where it is not required", () => {
    expect(needsSecondStep({ ...base, role: "admin", secondStep: true })).toBe(true);
    expect(
      needsSecondStep({ ...base, role: "owner", ownerRequired: false, secondStep: true }),
    ).toBe(true);
  });

  it("Crew never does, even with the flag left on (an Admin moved to Crew)", () => {
    expect(needsSecondStep({ ...base, role: "staff", secondStep: true })).toBe(false);
  });

  it("an Admin or Crew who did not turn it on never does", () => {
    expect(needsSecondStep({ ...base, role: "admin" })).toBe(false);
    expect(needsSecondStep({ ...base, role: "staff" })).toBe(false);
  });

  it("a session that passed it never does", () => {
    for (const role of ["owner", "admin", "staff"] as const) {
      expect(needsSecondStep({ ...base, role, secondStep: true, aal: "aal2" })).toBe(false);
    }
  });

  it("a token with no aal claim is treated as not passed", () => {
    expect(needsSecondStep({ ...base, role: "owner", aal: undefined })).toBe(true);
    expect(needsSecondStep({ ...base, role: "owner", aal: null })).toBe(true);
  });
});

describe("offersSecondStep and the environment's flag", () => {
  it("is offered to the Owner and Admins, not Crew", () => {
    expect(offersSecondStep("owner")).toBe(true);
    expect(offersSecondStep("admin")).toBe(true);
    expect(offersSecondStep("staff")).toBe(false);
  });

  it("is required only by an exact on", () => {
    expect(ownerSecondStepRequired({ OWNER_MFA_REQUIRED: "on" })).toBe(true);
    for (const value of [undefined, "", "off", "ON", "true", "1"]) {
      expect(ownerSecondStepRequired({ OWNER_MFA_REQUIRED: value })).toBe(false);
    }
  });
});

describe("totpSwitchedOff", () => {
  it("knows GoTrue's two answers for authenticator apps switched off, and nothing else", () => {
    expect(totpSwitchedOff("mfa_totp_enroll_not_enabled")).toBe(true);
    expect(totpSwitchedOff("mfa_totp_verify_not_enabled")).toBe(true);
    for (const code of [undefined, "mfa_verification_failed", "mfa_phone_enroll_not_enabled"]) {
      expect(totpSwitchedOff(code)).toBe(false);
    }
  });
});
