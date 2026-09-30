import { describe, expect, it } from "vitest";

import {
  collapseTicks,
  describeTaskActivity,
  type TaskActivityEntry,
  type TaskHistoryLine,
} from "../domain/activity";

function entry(overrides: Partial<TaskActivityEntry>): TaskActivityEntry {
  return {
    id: 1,
    actorId: "owner",
    onBehalfOfId: null,
    entity: "tasks",
    action: "created",
    old: {},
    new: {},
    meta: {},
    at: "2026-10-01T04:30:00Z",
    ...overrides,
  };
}

const TICK_AT = "2026-10-02T05:00:00.123+00:00";
const context = {
  names: { owner: "Prishit Shetty", ravi: "Ravi", asha: "Asha", admin: "Local Admin" },
  types: { meeting: "Meeting" },
  clients: { acme: "Acme Weddings" },
  tickedStages: { [Date.parse(TICK_AT)]: "Colour grade" },
};

function line(overrides: Partial<TaskActivityEntry>) {
  return describeTaskActivity(entry(overrides), context);
}

describe("a task's history (4.4, ADR-0013)", () => {
  it("names the pair when a coordinator acted for a freelancer", () => {
    expect(
      line({
        entity: "task_assignees",
        action: "acknowledged",
        actorId: "ravi",
        onBehalfOfId: "asha",
        meta: { member_id: "asha" },
      }),
    ).toMatchObject({ actor: "Ravi for Asha", text: "noted the task" });
    expect(
      line({
        action: "submitted",
        actorId: "ravi",
        onBehalfOfId: "asha",
        meta: { version: 1, late: true, admin_step: "required" },
        new: { late_reason: "The client sent the footage late" },
      }),
    ).toMatchObject({
      actor: "Ravi for Asha",
      text: "marked it done after the deadline",
      note: "Late: The client sent the footage late",
    });
  });

  it("describes assignments, the primary owner and a warning kept", () => {
    expect(
      line({
        entity: "task_assignees",
        action: "assigned",
        meta: { member_id: "asha", is_primary: true },
      })?.text,
    ).toBe("assigned Asha as the primary owner");
    expect(
      line({
        entity: "task_assignees",
        action: "primary_changed",
        meta: { from: "asha", to: "ravi" },
        new: { is_primary: false },
      }),
    ).toBeNull();
    expect(
      line({
        entity: "task_assignees",
        action: "primary_changed",
        meta: { from: "asha", to: "ravi" },
        new: { is_primary: true },
      })?.text,
    ).toBe("made Ravi the primary owner");
    expect(
      line({
        entity: "task_warnings",
        action: "warning_overridden",
        meta: { kind: "on_leave", member_id: "asha" },
      })?.text,
    ).toBe("assigned Asha despite leave that day");
  });

  it("describes the review steps with their reasons", () => {
    expect(line({ action: "admin_approved", actorId: "admin" })?.text).toBe(
      "checked it and passed it to the Owner",
    );
    expect(line({ action: "changes_requested", meta: { reason: "Fix the colour" } })).toMatchObject(
      {
        text: "asked for changes",
        note: "Fix the colour",
      },
    );
    expect(line({ action: "completed" })?.text).toBe("approved it: the task is complete");
    expect(line({ action: "approver_changed", meta: { from: "admin", to: null } })?.text).toBe(
      "removed Local Admin as approver: the Owner decides",
    );
    expect(
      line({
        action: "approver_changed",
        meta: { from: "admin", to: null, reason: "approver_deactivated" },
      })?.text,
    ).toBe("took Local Admin off as approver (deactivated): the Owner decides");
    expect(
      line({
        action: "approver_changed",
        meta: { from: "admin", to: null, reason: "approver_role_changed" },
      })?.text,
    ).toBe("took Local Admin off as approver (no longer an Admin): the Owner decides");
    expect(
      line({ action: "admin_step_skipped", meta: { reason: "approver_is_assignee" } })?.text,
    ).toBe("passed it to the Owner (no Admin check: the approver is on the task)");
    expect(
      line({ action: "admin_step_skipped", meta: { reason: "approver_is_coordinator" } })?.text,
    ).toBe("passed it to the Owner (no Admin check: the approver coordinates a freelancer on it)");
    expect(
      line({
        action: "submitted",
        meta: { version: 1, admin_step: "skipped", reason: "approver_is_coordinator" },
      })?.text,
    ).toBe("marked it done (no Admin check: the approver coordinates a freelancer on it)");
    // The review row only echoes its decision.
    expect(line({ entity: "task_reviews", action: "review_recorded" })).toBeNull();
  });

  it("names each field an edit changed", () => {
    expect(
      line({
        action: "updated",
        meta: { fields: ["due_at", "priority", "client_id", "task_type_id"] },
        old: {
          due_at: "2026-10-03T12:30:00+00:00",
          priority: "medium",
          client_id: null,
          task_type_id: "normal",
        },
        new: {
          due_at: "2026-10-04T12:30:00+00:00",
          priority: "urgent",
          client_id: "acme",
          task_type_id: "meeting",
        },
      })?.text,
    ).toBe(
      "moved the deadline from 3 Oct, 6:00 PM to 4 Oct, 6:00 PM, changed the priority from Medium to Urgent, labelled it Acme Weddings and changed the type to Meeting",
    );
  });

  it("names a stage ticked while it is still ticked, and leaves comments to their timeline", () => {
    expect(
      line({
        entity: "task_stages",
        action: "update",
        actorId: "ravi",
        onBehalfOfId: "asha",
        new: { done_at: TICK_AT },
      }),
    ).toMatchObject({ actor: "Ravi for Asha", text: "ticked “Colour grade”" });
    expect(
      line({ entity: "task_stages", action: "update", new: { done_at: "2026-10-01T00:00:00Z" } })
        ?.text,
    ).toBe("ticked a stage");
    expect(line({ entity: "task_stages", action: "update", new: { done_at: null } })?.text).toBe(
      "unticked a stage",
    );
    expect(
      line({ entity: "task_stages", action: "delete", old: { name: "Rough cut" } })?.text,
    ).toBe("removed the stage “Rough cut”");
    expect(line({ entity: "task_comments", action: "insert", new: { body: "hi" } })).toBeNull();
  });
});

describe("a Staff co-assignee's history (Kickoff 4 decision 21: every actor is named)", () => {
  it("names the Owner, an Admin and a former coordinator by name", () => {
    const staff = {
      ...context,
      names: { ravi: "Ravi", asha: "Asha", admin: "Local Admin", owner: "Prishit Shetty" },
    };
    const staffLine = (overrides: Partial<TaskActivityEntry>) =>
      describeTaskActivity(entry(overrides), staff);
    expect(
      staffLine({ action: "completed", actorId: "owner", meta: { step: "owner" } }),
    ).toMatchObject({ actor: "Prishit Shetty", text: "approved it: the task is complete" });
    expect(
      staffLine({ action: "changes_requested", actorId: "admin", meta: { step: "admin" } }),
    ).toMatchObject({ actor: "Local Admin", text: "asked for changes" });
    expect(
      staffLine({
        entity: "task_assignees",
        action: "acknowledged",
        actorId: "ravi",
        onBehalfOfId: "asha",
        meta: { member_id: "asha" },
      }),
    ).toMatchObject({ actor: "Ravi for Asha", text: "noted the task" });
  });

  it("says Someone only when a name is missing from the read (a race), never a role", () => {
    expect(
      describeTaskActivity(entry({ action: "completed", actorId: "gone" }), {
        names: {},
        types: {},
        clients: {},
      }),
    ).toMatchObject({ actor: "Someone" });
  });
});

describe("collapseTicks: consecutive ticks by one person are one line (Kickoff 4 decision 29)", () => {
  const minutes = (n: number) =>
    new Date(Date.parse("2026-10-02T05:00:00Z") + n * 60_000).toISOString();
  let nextId = 0;
  function tick(
    at: number,
    done: boolean,
    stage: string | null,
    who: { actorId: string; onBehalfOfId?: string | null } = { actorId: "ravi" },
  ): TaskHistoryLine {
    nextId += 1;
    return {
      id: nextId,
      at: minutes(at),
      actor: who.actorId,
      actorKey: `${who.actorId}|${who.onBehalfOfId ?? ""}`,
      text: done ? (stage ? `ticked “${stage}”` : "ticked a stage") : "unticked a stage",
      tick: { done, stage },
    };
  }
  function other(at: number): TaskHistoryLine {
    nextId += 1;
    return {
      id: nextId,
      at: minutes(at),
      actor: "asha",
      actorKey: "asha|",
      text: "noted the task",
    };
  }
  // The history reads newest first.
  const newestFirst = (...lines: TaskHistoryLine[]) => [...lines].reverse();

  it("folds a run of ticks within ten minutes into one line with the newest time", () => {
    const lines = newestFirst(tick(0, true, "Cut"), tick(3, true, "Grade"), tick(8, false, null));
    const [only, ...rest] = collapseTicks(lines);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      text: "ticked “Cut” and “Grade”, unticked a stage",
      at: minutes(8),
      count: 3,
    });
  });

  it("names unknown stages by count, and a stage ticked twice once", () => {
    const lines = newestFirst(
      tick(0, true, null),
      tick(1, true, "Cut"),
      tick(2, true, "Cut"),
      tick(3, true, null),
    );
    expect(collapseTicks(lines)[0]?.text).toBe("ticked “Cut” and 2 more stages");
    expect(collapseTicks(newestFirst(tick(0, true, null), tick(1, true, null)))[0]?.text).toBe(
      "ticked 2 stages",
    );
    expect(collapseTicks(newestFirst(tick(0, true, null), tick(1, false, null)))[0]?.text).toBe(
      "ticked a stage, unticked a stage",
    );
  });

  it("keeps ticks apart when they are more than ten minutes from the run's first", () => {
    const lines = newestFirst(tick(0, true, "Cut"), tick(6, true, "Grade"), tick(11, true, "Mix"));
    expect(collapseTicks(lines).map((line) => line.text)).toEqual([
      "ticked “Mix”",
      "ticked “Cut” and “Grade”",
    ]);
  });

  it("never folds another person's ticks, a coordinator's for a freelancer into theirs, or across another entry", () => {
    const byAsha = { actorId: "asha" };
    const forBala = { actorId: "ravi", onBehalfOfId: "bala" };
    expect(
      collapseTicks(newestFirst(tick(0, true, "Cut"), tick(1, true, "Grade", byAsha))),
    ).toHaveLength(2);
    expect(
      collapseTicks(newestFirst(tick(0, true, "Cut"), tick(1, true, "Grade", forBala))),
    ).toHaveLength(2);
    expect(
      collapseTicks(newestFirst(tick(0, true, "Cut"), other(1), tick(2, true, "Grade"))).map(
        (line) => line.text,
      ),
    ).toEqual(["ticked “Grade”", "noted the task", "ticked “Cut”"]);
  });

  it("leaves a single tick and every other entry as they were", () => {
    const lines = newestFirst(other(0), tick(5, true, "Cut"), other(20));
    expect(collapseTicks(lines)).toEqual(lines);
  });

  it("gives every line the pair it describes, and a tick its way and stage", () => {
    expect(
      line({
        entity: "task_stages",
        action: "update",
        actorId: "ravi",
        onBehalfOfId: "asha",
        new: { done_at: TICK_AT },
      }),
    ).toMatchObject({ actorKey: "ravi|asha", tick: { done: true, stage: "Colour grade" } });
    expect(line({ entity: "task_stages", action: "update", new: { done_at: null } })).toMatchObject(
      { actorKey: "owner|", tick: { done: false, stage: null } },
    );
    expect(line({ action: "created" })?.tick).toBeUndefined();
  });
});
