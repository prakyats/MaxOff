import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  args: null as unknown,
  answer: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/session-bundle", () => ({ getSessionBundle: vi.fn() }));
vi.mock("@/core/db/server", () => ({
  createServerSupabase: async () => ({
    rpc: async (_name: string, args: unknown) => {
      fake.args = args;
      return { data: fake.answer, error: null };
    },
  }),
}));

import { CHAT_PAGE } from "../domain/chat";
import { readTaskPage } from "../data/tasks";

const comment = (n: number) => ({
  id: `c${n}`,
  author_id: "m1",
  on_behalf_of: null,
  body: `note ${n}`,
  created_at: `2026-11-05T10:${String(n).padStart(2, "0")}:00+00:00`,
});

const EMPTY = {
  task: null,
  assignees: [],
  stages: [],
  comments: [],
  submissions: [],
  reviews: [],
  activity: [],
  last_read: null,
  coordinators: [],
  freelancers: [],
  labels: [],
};

describe("readTaskPage (v2.0 X3: a task's page in one read)", () => {
  it("asks for one comment past a page and the history's limit", async () => {
    fake.answer = { ...EMPTY };
    await readTaskPage("t1");
    expect(fake.args).toEqual({ p_task_id: "t1", p_comments: CHAT_PAGE + 1, p_activity: 50 });
  });

  it("maps the comments as listComments does: oldest first, and whether earlier ones remain", async () => {
    // Newest first, as the read gives them, one more than a page.
    fake.answer = {
      ...EMPTY,
      comments: Array.from({ length: CHAT_PAGE + 1 }, (_, i) => comment(CHAT_PAGE - i)),
    };
    const page = await readTaskPage("t1");
    expect(page.chat.more).toBe(true);
    expect(page.chat.comments).toHaveLength(CHAT_PAGE);
    expect(page.chat.comments[0]?.id).toBe("c1");
    expect(page.chat.comments.at(-1)?.id).toBe(`c${CHAT_PAGE}`);
  });

  it("a task the viewer may not see: null, every part empty", async () => {
    fake.answer = { ...EMPTY };
    const page = await readTaskPage("t1");
    expect(page.task).toBeNull();
    expect(page.chat).toEqual({ comments: [], more: false });
    expect(page.lastRead).toBeNull();
  });

  it("maps the people, stages and history with the reads' own mappers", async () => {
    fake.answer = {
      ...EMPTY,
      assignees: [
        {
          member_id: "m1",
          is_primary: true,
          assigned_at: "2026-11-05T09:00:00+00:00",
          acknowledged_at: null,
          acknowledged_by: null,
          removed_at: null,
        },
      ],
      stages: [
        { id: "s1", name: "Cut", position: "a0", done_at: null, done_by: null, on_behalf_of: null },
      ],
      activity: [
        {
          id: 7,
          actor_id: "m1",
          on_behalf_of_id: null,
          entity: "tasks",
          entity_id: "t1",
          action: "created",
          diff: { new: { title: "A" } },
          meta: {},
          at: "2026-11-05T09:00:00+00:00",
        },
      ],
      last_read: "2026-11-05T11:00:00+00:00",
      freelancers: ["f1"],
    };
    const page = await readTaskPage("t1");
    expect(page.assignees[0]).toMatchObject({ memberId: "m1", isPrimary: true });
    expect(page.stages[0]).toMatchObject({ id: "s1", name: "Cut" });
    expect(page.activity[0]).toMatchObject({ action: "created", new: { title: "A" }, old: {} });
    expect(page.lastRead).toBe("2026-11-05T11:00:00+00:00");
    expect(page.freelancers).toEqual(["f1"]);
  });
});
