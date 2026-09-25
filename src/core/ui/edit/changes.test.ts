import { describe, expect, it } from "vitest";

import { describeChange, diffFields, normalise } from "./changes";

describe("diffFields (task 2.9)", () => {
  const names = ["fullName", "phone"];

  it("finds only the fields that really changed, in order", () => {
    expect(
      diffFields(names, { fullName: "Asha", phone: "98" }, { fullName: "Asha Rao", phone: "98" }),
    ).toEqual([{ name: "fullName", from: "Asha", to: "Asha Rao" }]);
  });

  it("treats whitespace, null, undefined and blank as the same nothing", () => {
    expect(
      diffFields(names, { fullName: " Asha ", phone: null }, { fullName: "Asha", phone: "  " }),
    ).toEqual([]);
    expect(normalise(undefined)).toBe("");
  });

  it("reports a value added and a value removed", () => {
    expect(diffFields(["phone"], { phone: null }, { phone: "98450" })).toEqual([
      { name: "phone", from: "", to: "98450" },
    ]);
    expect(diffFields(["phone"], { phone: "98450" }, { phone: "" })).toEqual([
      { name: "phone", from: "98450", to: "" },
    ]);
  });
});

describe("describeChange: the confirmation names the change (ARCHITECTURE §14.1)", () => {
  it("speaks to the member about their own record", () => {
    expect(describeChange({ name: "fullName", from: "Asha", to: "Asha Rao" }, "name", "self")).toBe(
      "Your name will change from Asha to Asha Rao.",
    );
  });

  it("names the person when the record is someone else's", () => {
    expect(describeChange({ name: "role", from: "Staff", to: "Admin" }, "role", "Ravi")).toBe(
      "Ravi's role will change from Staff to Admin.",
    );
  });

  it("says set and removed rather than 'from nothing' and 'to nothing'", () => {
    expect(describeChange({ name: "phone", from: "", to: "98450" }, "phone number", "self")).toBe(
      "Your phone number will be set to 98450.",
    );
    expect(describeChange({ name: "phone", from: "98450", to: "" }, "phone number", "self")).toBe(
      "Your phone number will be removed.",
    );
  });
});
