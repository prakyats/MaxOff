import { describe, expect, it } from "vitest";

import type { TeamMember } from "../domain/members";

import { memberChangeLines } from "./member-changes";

const RAVI = {
  id: "m1",
  fullName: "Ravi",
  role: "staff",
  jobTitleId: "t1",
  jobTitle: "Editor",
} as TeamMember;
const TITLES = [
  { id: "t1", name: "Editor" },
  { id: "t2", name: "Shooter" },
];

describe("memberChangeLines: the Owner's edit names each change (task 2.9)", () => {
  it("names a role change in the person's name", () => {
    expect(
      memberChangeLines(RAVI, { fullName: "Ravi", role: "admin", jobTitleId: "t1" }, TITLES),
    ).toEqual(["Ravi's role will change from Staff to Admin."]);
  });

  it("names every field that changed, as the screen shows them", () => {
    expect(
      memberChangeLines(RAVI, { fullName: "Ravi Kumar", role: "staff", jobTitleId: "t2" }, TITLES),
    ).toEqual([
      "Ravi's name will change from Ravi to Ravi Kumar.",
      "Ravi's job title will change from Editor to Shooter.",
    ]);
  });

  it("says a job title is removed or set, and nothing when nothing changed", () => {
    expect(
      memberChangeLines(RAVI, { fullName: "Ravi", role: "staff", jobTitleId: "" }, TITLES),
    ).toEqual(["Ravi's job title will be removed."]);
    const untitled = { ...RAVI, jobTitleId: null, jobTitle: null };
    expect(
      memberChangeLines(untitled, { fullName: "Ravi", role: "staff", jobTitleId: "t2" }, TITLES),
    ).toEqual(["Ravi's job title will be set to Shooter."]);
    expect(
      memberChangeLines(RAVI, { fullName: " Ravi ", role: "staff", jobTitleId: "t1" }, TITLES),
    ).toEqual([]);
  });
});
