import { describe, expect, it } from "vitest";

import {
  clientLines,
  clientTotals,
  daysWords,
  delayPatterns,
  delayWords,
  type DelayFact,
  medianWords,
  peopleRows,
  type PersonFacts,
  personLines,
  stageReport,
  type StageFact,
  stageWords,
} from "../domain/owner-reports";
import { OWNER_CUSTOM_MAX_DAYS, parsePeriod, periodHref, weekOf } from "../domain/work-report";

const TODAY = "2026-11-25";

function facts(over: Partial<PersonFacts> = {}): PersonFacts {
  return {
    memberId: "m1",
    completed: 0,
    onTime: 0,
    ownedCompleted: 0,
    revisionLoops: 0,
    handInHours: null,
    ackLagHours: null,
    openNow: 0,
    overdueNow: 0,
    ...over,
  };
}

describe("the Owner's report periods (v3.0, decision 12)", () => {
  it("a custom range runs up to 366 days for the Owner and 92 for the Admin", () => {
    const range = { from: "2025-11-01", to: "2026-11-20" };
    expect(parsePeriod(range, TODAY, OWNER_CUSTOM_MAX_DAYS)).toEqual({
      kind: "custom",
      from: "2025-11-01",
      to: "2026-11-01",
    });
    expect(parsePeriod(range, TODAY).to).toBe("2026-01-31");
  });

  it("each report keeps its own address", () => {
    expect(periodHref(weekOf(TODAY), "/reports/people")).toBe(
      "/reports/people?period=week&at=2026-11-23",
    );
    expect(
      periodHref({ kind: "custom", from: "2026-10-01", to: "2026-10-05" }, "/reports/stages"),
    ).toBe("/reports/stages?from=2026-10-01&to=2026-10-05");
    expect(periodHref(weekOf(TODAY))).toBe("/reports?period=week&at=2026-11-23");
  });
});

describe("the people report (decision 13)", () => {
  const people = [
    { id: "a", fullName: "Zara", engagement: "permanent" as const },
    { id: "b", fullName: "Anil", engagement: "permanent" as const },
    { id: "c", fullName: "Meera", engagement: "freelance" as const },
    { id: "d", fullName: "Dev", engagement: "permanent" as const },
  ];

  it("splits by engagement, sorts by name (never by a number) and folds the quiet away", () => {
    const { rows, quiet } = peopleRows(
      [
        facts({ memberId: "a", completed: 9 }),
        facts({ memberId: "b", completed: 1 }),
        facts({ memberId: "c", openNow: 2 }),
        facts({ memberId: "d" }),
      ],
      people,
    );
    expect(rows.permanent.map((row) => row.fullName)).toEqual(["Anil", "Zara"]);
    expect(rows.freelance.map((row) => row.fullName)).toEqual(["Meera"]);
    expect(quiet.permanent.map((row) => row.fullName)).toEqual(["Dev"]);
  });

  it("someone the directory doesn't know keeps their facts", () => {
    const { rows } = peopleRows([facts({ memberId: "x", completed: 1 })], people);
    expect(rows.permanent[0]?.fullName).toBe("Someone");
  });

  it("always all seven facts, in the same order, in plain words", () => {
    const lines = personLines(
      facts({
        completed: 3,
        onTime: 1,
        ownedCompleted: 2,
        revisionLoops: 1,
        handInHours: 30,
        ackLagHours: 1.5,
        openNow: 1,
        overdueNow: 0,
      }),
    );
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ["Completed", "3 tasks"],
      ["On time", "1 of 2"],
      ["Revision loops", "1 send-back"],
      ["To first hand-in", "Median 30 h"],
      ["Acknowledgement lag", "Median 1.5 h"],
      ["Open now", "1 task"],
      ["Overdue now", "0 tasks"],
    ]);
    expect(personLines(facts()).map((line) => line.value)).toEqual([
      "0 tasks",
      "None of their own",
      "None",
      "No data",
      "No data",
      "0 tasks",
      "0 tasks",
    ]);
    expect(medianWords(72)).toBe("Median 3 days");
  });
});

describe("the delay patterns (decision 14)", () => {
  const delay = (over: Partial<DelayFact>): DelayFact => ({
    taskId: "t",
    title: "Task",
    primaryOwnerId: "a",
    typeName: "Shoot",
    clientName: "Cafe",
    dueAt: "2026-11-05T12:30:00Z",
    handedInAt: null,
    open: true,
    lateReason: null,
    ...over,
  });

  it("types and clients most first, people by name", () => {
    const names: Record<string, string> = { a: "Zara", b: "Anil" };
    const patterns = delayPatterns(
      [
        delay({ taskId: "1", primaryOwnerId: "a", typeName: "Edit" }),
        delay({ taskId: "2", primaryOwnerId: "a", typeName: "Shoot" }),
        delay({ taskId: "3", primaryOwnerId: "a", typeName: "Shoot", clientName: null }),
        delay({ taskId: "4", primaryOwnerId: "b", typeName: null }),
      ],
      (id) => names[id] ?? "Someone",
    );
    expect(patterns.byPerson.map((g) => [g.label, g.count])).toEqual([
      ["Anil", 1],
      ["Zara", 3],
    ]);
    expect(patterns.byType.map((g) => [g.label, g.count])).toEqual([
      ["Shoot", 2],
      ["Edit", 1],
      ["No type", 1],
    ]);
    expect(patterns.byClient.map((g) => [g.label, g.count])).toEqual([
      ["Cafe", 3],
      ["No client label", 1],
    ]);
  });

  it("says how late, handed in or still open", () => {
    const now = new Date("2026-11-08T12:30:00Z");
    expect(delayWords(delay({ handedInAt: "2026-11-07T12:30:00Z" }), now)).toBe(
      "Due 5 Nov · handed in 2 days late",
    );
    expect(delayWords(delay({}), now)).toBe("Due 5 Nov · still open, 3 days past");
    expect(delayWords(delay({ handedInAt: "2026-11-05T13:30:00Z" }), now)).toBe(
      "Due 5 Nov · handed in 1 day late",
    );
  });
});

describe("stage durations (R7)", () => {
  const fact = (over: Partial<StageFact>): StageFact => ({
    projectId: null,
    projectName: null,
    clientName: null,
    stageKey: "edit",
    stageName: "Edit",
    ticks: 2,
    medianDays: 3,
    longestDays: 5,
    ...over,
  });

  it("the overall list and each project's, slowest first; projects by client then name", () => {
    const report = stageReport([
      fact({ stageKey: "shoot", stageName: "Shoot", medianDays: 1 }),
      fact({ stageKey: "edit", medianDays: 4 }),
      fact({
        projectId: "p2",
        projectName: "B",
        clientName: "Cafe",
        stageKey: "shoot",
        medianDays: 1,
      }),
      fact({
        projectId: "p2",
        projectName: "B",
        clientName: "Cafe",
        stageKey: "edit",
        medianDays: 5,
      }),
      fact({
        projectId: "p1",
        projectName: "A",
        clientName: "Zoo",
        stageKey: "edit",
        medianDays: 2,
      }),
    ]);
    expect(report.overall.map((s) => s.stageKey)).toEqual(["edit", "shoot"]);
    expect(report.projects.map((p) => p.projectId)).toEqual(["p2", "p1"]);
    expect(report.projects[0]?.stages.map((s) => s.stageKey)).toEqual(["edit", "shoot"]);
  });

  it("days in words", () => {
    expect(daysWords(0.01)).toBe("Under an hour");
    expect(daysWords(0.25)).toBe("6 hours");
    expect(daysWords(1)).toBe("1 day");
    expect(daysWords(2.46)).toBe("2.5 days");
    expect(stageWords({ medianDays: 3, longestDays: 8, ticks: 12 })).toBe(
      "Median 3 days · longest 8 days · 12 done",
    );
  });
});

describe("client work", () => {
  const row = {
    clientId: "c",
    clientName: "Cafe",
    planned: 3,
    done: 2,
    doneOnTime: 1,
    doneInPeriod: 2,
    overdueNow: 1,
    onHold: 0,
    projectsCompleted: 1,
  };

  it("a client's lines, and nothing planned said plainly", () => {
    expect(clientLines(row).map((line) => [line.label, line.value])).toEqual([
      ["Planned in the period", "2 of 3 done"],
      ["On time", "1 of 3"],
      ["Done in the period", "2 deliverables"],
      ["Overdue now", "1 deliverable"],
      ["On hold now", "0 deliverables"],
      ["Projects completed", "1 project"],
    ]);
    expect(
      clientLines({ ...row, planned: 0 })
        .slice(0, 2)
        .map((line) => line.value),
    ).toEqual(["Nothing planned", "—"]);
  });

  it("the totals add every client", () => {
    const total = clientTotals([row, { ...row, clientId: "d", planned: 1, projectsCompleted: 0 }]);
    expect(total).toMatchObject({
      clientName: "All clients",
      planned: 4,
      done: 4,
      projectsCompleted: 1,
    });
  });
});
