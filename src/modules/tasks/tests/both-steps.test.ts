import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  steps: [] as [string, ...unknown[]][],
  rows: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/activity/server", () => ({ listActivity: vi.fn() }));
vi.mock("@/core/auth/session-bundle", () => ({ getSessionBundle: vi.fn() }));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    from(table: string) {
      fake.steps.push(["from", table]);
      // Every builder call is recorded and chains; awaiting the builder answers the rows.
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => void) => resolve({ data: fake.rows, error: null }),
      };
      for (const method of ["select", "order", "limit", "eq", "or"]) {
        builder[method] = (...args: unknown[]) => {
          fake.steps.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
  }),
}));

import { listTasksAtBothSteps } from "../data/tasks";

const ADMIN = "a0000000-0000-4000-8000-000000000001";
const OTHER_ADMIN = "a0000000-0000-4000-8000-000000000002";
const CREW = "c0000000-0000-4000-8000-000000000003";

function assignee(memberId: string, removedAt: string | null = null) {
  return {
    member_id: memberId,
    is_primary: memberId === CREW,
    assigned_at: "2026-11-01T04:00:00Z",
    acknowledged_at: "2026-11-01T05:00:00Z",
    removed_at: removedAt,
  };
}

function row(id: string, state: string, approvingAdminId: string | null, people: unknown[]) {
  return {
    id,
    title: id,
    state,
    admin_step: null,
    priority: "medium",
    due_at: "2026-11-12T12:30:00Z",
    client_id: null,
    task_type_id: "t0000000-0000-4000-8000-000000000001",
    primary_owner_id: CREW,
    approving_admin_id: approvingAdminId,
    created_by: ADMIN,
    submitted_at: "2026-11-10T09:00:00Z",
    created_at: "2026-11-01T04:00:00Z",
    held_at: null,
    hold_reason: null,
    task_assignees: people,
    late_reason: null,
    task_submissions: [],
    task_reviews: [],
  };
}

/**
 * Approvals' both-steps read (v2.0 X3; X5+ H5): one query for the final step and the viewer's
 * check, before the role is known; the role then picks one. RLS decides the rows; this checks the
 * filter sent and how the answer is split.
 */
describe("listTasksAtBothSteps", () => {
  beforeEach(() => {
    fake.steps.length = 0;
    fake.rows = [];
  });

  it("asks for the final step and this Admin's check in one filter", async () => {
    await listTasksAtBothSteps(ADMIN);
    expect(fake.steps[0]).toEqual(["from", "tasks"]);
    expect(fake.steps.filter(([method]) => method === "or")).toEqual([
      ["or", `state.eq.admin_approved,and(state.eq.submitted,approving_admin_id.eq.${ADMIN})`],
    ]);
  });

  it("splits the answer: final = waiting for the Owner, check = this Admin's submitted ones", async () => {
    fake.rows = [
      row("final", "admin_approved", ADMIN, [assignee(CREW)]),
      row("mine to check", "submitted", ADMIN, [assignee(CREW)]),
      // Another Admin's check (RLS may still show it): never this Admin's.
      row("theirs to check", "submitted", OTHER_ADMIN, [assignee(CREW)]),
    ];
    const { final, check } = await listTasksAtBothSteps(ADMIN);
    expect(final.map(({ row }) => row.id)).toEqual(["final"]);
    expect(check.map(({ row }) => row.id)).toEqual(["mine to check"]);
  });

  it("drops a check on a task the Admin is on, keeps one they were removed from", async () => {
    fake.rows = [
      row("on it", "submitted", ADMIN, [assignee(CREW), assignee(ADMIN)]),
      row("removed from it", "submitted", ADMIN, [
        assignee(CREW),
        assignee(ADMIN, "2026-11-05T06:00:00Z"),
      ]),
      // The final step never drops a task for the Admin being on it: the Owner decides it.
      row("final, Admin on it", "admin_approved", ADMIN, [assignee(CREW), assignee(ADMIN)]),
    ];
    const { final, check } = await listTasksAtBothSteps(ADMIN);
    expect(check.map(({ row }) => row.id)).toEqual(["removed from it"]);
    expect(final.map(({ row }) => row.id)).toEqual(["final, Admin on it"]);
  });
});
