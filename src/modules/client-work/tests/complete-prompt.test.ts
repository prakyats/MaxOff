import { describe, expect, it } from "vitest";

import { isLastOpenOfOneTime, readyProjects, type CompletableProject } from "../domain/projects";
import { itemIdSchema } from "../domain/schemas";
import type { ItemState } from "../domain/types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const oneTime: CompletableProject = { recurrence: "one_time", state: "in_progress", held: false };
const items = (...states: ItemState[]) =>
  states.map((state, index) => ({ id: [A, B, C][index] ?? `x${index}`, state }));

describe("isLastOpenOfOneTime (kickoff 9 R1)", () => {
  it("is true for the only open deliverable of a working one-time project", () => {
    expect(isLastOpenOfOneTime(oneTime, A, items("open"))).toBe(true);
    expect(isLastOpenOfOneTime({ ...oneTime, state: "open" }, A, items("open"))).toBe(true);
  });

  it("ignores the others once they are done, closed or carried", () => {
    expect(isLastOpenOfOneTime(oneTime, A, items("open", "approved"))).toBe(true);
    expect(isLastOpenOfOneTime(oneTime, A, items("open", "cancelled"))).toBe(true);
    expect(isLastOpenOfOneTime(oneTime, A, items("open", "carried"))).toBe(true);
    expect(isLastOpenOfOneTime(oneTime, A, items("open", "approved", "cancelled"))).toBe(true);
  });

  it("is false while another deliverable is open or waiting", () => {
    expect(isLastOpenOfOneTime(oneTime, A, items("open", "open"))).toBe(false);
    expect(isLastOpenOfOneTime(oneTime, A, items("open", "approved", "open"))).toBe(false);
    expect(isLastOpenOfOneTime(oneTime, A, items("open", "done"))).toBe(false);
  });

  it("is false for a deliverable that is not open, or not the project's", () => {
    expect(isLastOpenOfOneTime(oneTime, A, items("approved"))).toBe(false);
    expect(isLastOpenOfOneTime(oneTime, A, items("done"))).toBe(false);
    expect(isLastOpenOfOneTime(oneTime, C, items("open"))).toBe(false);
    expect(isLastOpenOfOneTime(oneTime, A, [])).toBe(false);
  });

  it("is never true for a repeating project", () => {
    expect(isLastOpenOfOneTime({ ...oneTime, recurrence: "monthly" }, A, items("open"))).toBe(
      false,
    );
    expect(isLastOpenOfOneTime({ ...oneTime, recurrence: "weekly" }, A, items("open"))).toBe(false);
  });

  it("is false on hold, completed or cancelled", () => {
    expect(isLastOpenOfOneTime({ ...oneTime, held: true }, A, items("open"))).toBe(false);
    expect(isLastOpenOfOneTime({ ...oneTime, state: "completed" }, A, items("open"))).toBe(false);
    expect(isLastOpenOfOneTime({ ...oneTime, state: "cancelled" }, A, items("open"))).toBe(false);
  });
});

describe("readyProjects (the All deliverables done toast)", () => {
  const project = { ...oneTime, id: A, clientId: B, name: "Brand film" };

  it("names a working one-time project with every deliverable done, and its page", () => {
    expect(readyProjects([{ ...project, states: ["approved", "approved", "cancelled"] }])).toEqual([
      { id: A, name: "Brand film", href: `/clients/${B}/projects/${A}` },
    ]);
  });

  it("leaves out one with something open or waiting, or nothing done", () => {
    expect(readyProjects([{ ...project, states: ["approved", "open"] }])).toEqual([]);
    expect(readyProjects([{ ...project, states: ["approved", "done"] }])).toEqual([]);
    expect(readyProjects([{ ...project, states: ["cancelled"] }])).toEqual([]);
    expect(readyProjects([{ ...project, states: [] }])).toEqual([]);
  });

  it("leaves out a repeating, held or finished project", () => {
    const done: ItemState[] = ["approved"];
    expect(readyProjects([{ ...project, recurrence: "monthly", states: done }])).toEqual([]);
    expect(readyProjects([{ ...project, held: true, states: done }])).toEqual([]);
    expect(readyProjects([{ ...project, state: "completed", states: done }])).toEqual([]);
  });

  it("carries nothing but the id, the name and the address", () => {
    const [ready] = readyProjects([{ ...project, states: ["approved"] }]);
    expect(Object.keys(ready ?? {}).sort()).toEqual(["href", "id", "name"]);
  });
});

describe("markDoneAndCompleteProject's input (itemIdSchema)", () => {
  it("takes one deliverable id", () => {
    expect(itemIdSchema.parse({ itemId: A })).toEqual({ itemId: A });
  });

  it("refuses anything that is not a uuid, and a missing id", () => {
    expect(itemIdSchema.safeParse({ itemId: "reel-1" }).success).toBe(false);
    expect(itemIdSchema.safeParse({}).success).toBe(false);
  });
});
