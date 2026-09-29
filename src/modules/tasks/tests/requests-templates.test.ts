import { describe, expect, it } from "vitest";

import { emptyDraft } from "../domain/form";
import {
  requestActions,
  requestByline,
  requestOutcome,
  splitRequests,
  type TaskRequest,
} from "../domain/requests";
import { convertRequestSchema, createRequestSchema, saveTemplateSchema } from "../domain/schemas";
import {
  activeTemplates,
  applyTemplate,
  templateActions,
  type TaskTemplate,
} from "../domain/templates";

function request(overrides: Partial<TaskRequest>): TaskRequest {
  return {
    id: "r",
    requestedBy: "staff",
    title: "Reel for the launch",
    details: null,
    clientId: null,
    state: "pending",
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    taskId: null,
    createdAt: "2026-10-02T06:30:00Z",
    ...overrides,
  };
}

function template(overrides: Partial<TaskTemplate>): TaskTemplate {
  return {
    id: "t",
    name: "Wedding reel",
    taskTypeId: "shoot",
    description: "Cut a 60 s reel.",
    defaultPriority: "high",
    stages: ["Rough cut", "Colour"],
    fieldDefaults: { reel_length: 60 },
    archived: false,
    createdBy: "admin",
    ...overrides,
  };
}

const names: Record<string, string> = { staff: "Meera", admin: "Ravi" };
const nameOf = (id: string) => names[id] ?? null;

describe("task requests (4.6)", () => {
  it("lets whoever decides convert or decline a waiting one, and its suggester withdraw it", () => {
    const admin = { id: "admin", role: "admin" as const, decides: true };
    const staff = { id: "staff", role: "staff" as const, decides: false };
    expect(requestActions(request({}), admin)).toEqual({
      convert: true,
      decline: true,
      withdraw: false,
    });
    expect(requestActions(request({}), staff)).toEqual({
      convert: false,
      decline: false,
      withdraw: true,
    });
    // An Admin's own suggestion: both.
    expect(requestActions(request({ requestedBy: "admin" }), admin)).toEqual({
      convert: true,
      decline: true,
      withdraw: true,
    });
    expect(requestActions(request({ state: "declined" }), admin)).toEqual({
      convert: false,
      decline: false,
      withdraw: false,
    });
  });

  it("says who suggested it and what became of it", () => {
    expect(requestByline(request({}), "admin", (id) => names[id] ?? "someone")).toBe(
      "Suggested by Meera, 2 Oct",
    );
    expect(requestByline(request({}), "staff", (id) => names[id] ?? "someone")).toBe(
      "Suggested by you, 2 Oct",
    );
    const decided = { decidedBy: "admin", decidedAt: "2026-10-03T05:00:00Z" };
    expect(requestOutcome(request({ state: "declined", ...decided }), "staff", nameOf)).toBe(
      "Declined by Ravi, 3 Oct",
    );
    expect(requestOutcome(request({ state: "converted", ...decided }), "admin", nameOf)).toBe(
      "Made a task by you, 3 Oct",
    );
    // A decider the viewer's directory does not hold is not named.
    expect(
      requestOutcome(
        request({ state: "declined", ...decided, decidedBy: "owner" }),
        "staff",
        nameOf,
      ),
    ).toBe("Declined, 3 Oct");
    expect(requestOutcome(request({ state: "withdrawn" }), "staff", nameOf)).toBe("Withdrawn");
    expect(requestOutcome(request({}), "staff", nameOf)).toBeNull();
  });

  it("puts the waiting ones first, as read", () => {
    const { waiting, decided } = splitRequests([
      request({ id: "a" }),
      request({ id: "b", state: "declined" }),
      request({ id: "c" }),
    ]);
    expect(waiting.map((r) => r.id)).toEqual(["a", "c"]);
    expect(decided.map((r) => r.id)).toEqual(["b"]);
  });

  it("needs a title, and keeps the details and the client optional", () => {
    expect(createRequestSchema.safeParse({ title: " ", clientId: null }).success).toBe(false);
    expect(createRequestSchema.parse({ title: " Reel ", details: " ", clientId: null })).toEqual({
      title: "Reel",
      details: null,
      clientId: null,
    });
  });

  it("converts with the create form's fields and the request", () => {
    const parsed = convertRequestSchema.safeParse({ title: "Reel" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path[0])).toContain("requestId");
    }
  });
});

describe("task templates (4.6)", () => {
  it("lets the author or the Owner edit and archive, anyone restore nothing else", () => {
    expect(templateActions(template({}), { id: "admin", role: "admin" })).toEqual({
      edit: true,
      archive: true,
      restore: false,
    });
    expect(templateActions(template({}), { id: "other", role: "admin" })).toEqual({
      edit: false,
      archive: false,
      restore: false,
    });
    expect(templateActions(template({ archived: true }), { id: "o", role: "owner" })).toEqual({
      edit: false,
      archive: false,
      restore: true,
    });
  });

  it("starts a task from a template, never its title, people, deadline or client", () => {
    const draft = {
      ...emptyDraft(),
      title: "Sharma wedding reel",
      clientId: "client",
      assigneeIds: ["staff"],
      primaryOwnerId: "staff",
      dueDate: "2026-10-09",
      customFields: { reel_length: 90 },
    };
    const next = applyTemplate(
      draft,
      template({ fieldDefaults: { reel_length: 60, music: "Calm" } }),
    );
    expect(next).toMatchObject({
      title: "Sharma wedding reel",
      clientId: "client",
      assigneeIds: ["staff"],
      dueDate: "2026-10-09",
      taskTypeId: "shoot",
      priority: "high",
      stages: ["Rough cut", "Colour"],
      description: "Cut a 60 s reel.",
      // A value typed stays; an empty one takes the default.
      customFields: { reel_length: 90, music: "Calm" },
    });
    expect(applyTemplate({ ...draft, description: "Mine" }, template({})).description).toBe("Mine");
  });

  it("offers the active ones by name", () => {
    expect(
      activeTemplates([
        template({ id: "b", name: "Podcast" }),
        template({ id: "x", name: "Archived", archived: true }),
        template({ id: "a", name: "Birthday" }),
      ]).map((t) => t.name),
    ).toEqual(["Birthday", "Podcast"]);
  });

  it("names the template and its type; never a client, people or a deadline", () => {
    const parsed = saveTemplateSchema.parse({
      templateId: null,
      template: {
        name: " Reel ",
        taskTypeId: "00000000-0000-4000-8000-000000000001",
        description: null,
        defaultPriority: "low",
        stages: [" Cut "],
        fieldDefaults: {},
        clientId: "00000000-0000-4000-8000-000000000002",
      },
    });
    expect(parsed.template).toEqual({
      name: "Reel",
      taskTypeId: "00000000-0000-4000-8000-000000000001",
      description: null,
      defaultPriority: "low",
      stages: ["Cut"],
      fieldDefaults: {},
    });
  });
});
