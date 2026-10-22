import { describe, expect, it } from "vitest";

import {
  deleteNeedsUsage,
  deletedTemplateLabel,
  templateDeleteCopy,
  usageFromJson,
} from "./owner-delete";

describe("templateDeleteCopy", () => {
  it("says the owner's sentence for a used project template", () => {
    expect(templateDeleteCopy("project", "Retainer 1", { used: 3, open: 2 })).toEqual({
      title: "Delete template “Retainer 1”?",
      description:
        "Used by 3 projects (2 still open). They keep all their deliverables, stages and months exactly as they are. Their details will show “Template: Retainer 1 (deleted)”. New projects can't use it any more. This can't be undone.",
      confirmLabel: "Delete Retainer 1",
    });
  });

  it("speaks of one project in the singular, and says when none is open", () => {
    expect(templateDeleteCopy("project", "One", { used: 1, open: 1 }).description).toBe(
      "Used by 1 project (still open). It keeps all its deliverables, stages and months exactly as they are. Its details will show “Template: One (deleted)”. New projects can't use it any more. This can't be undone.",
    );
    expect(templateDeleteCopy("project", "Two", { used: 2, open: 0 }).description).toMatch(
      /^Used by 2 projects\. They keep/,
    );
    expect(templateDeleteCopy("project", "All", { used: 2, open: 2 }).description).toMatch(
      /^Used by 2 projects \(all still open\)\./,
    );
  });

  it("an unused project template", () => {
    expect(templateDeleteCopy("project", "Spare", { used: 0, open: 0 }).description).toBe(
      "No project was started from it. New projects can't use it any more. This can't be undone.",
    );
  });

  it("a task template promises the open tasks their reminders", () => {
    expect(templateDeleteCopy("task", "Weekly post", { used: 4, open: 2 }).description).toBe(
      "Used by 4 tasks (2 still open). They keep everything exactly as it is. Open tasks keep the same reminders. New tasks can't use it any more. This can't be undone.",
    );
    expect(templateDeleteCopy("task", "Solo", { used: 1, open: 1 }).description).toBe(
      "Used by 1 task (still open). It keeps everything exactly as it is. Its reminders stay the same. New tasks can't use it any more. This can't be undone.",
    );
    expect(templateDeleteCopy("task", "Done", { used: 3, open: 0 }).description).toBe(
      "Used by 3 tasks. They keep everything exactly as it is. New tasks can't use it any more. This can't be undone.",
    );
    expect(templateDeleteCopy("task", "Spare", { used: 0, open: 0 }).description).toBe(
      "No task was started from it. New tasks can't use it any more. This can't be undone.",
    );
  });

  it("deliverable templates and presets are copies", () => {
    expect(templateDeleteCopy("deliverable", "Reel", { used: 0, open: 0 })).toEqual({
      title: "Delete template “Reel”?",
      description:
        "Deliverables already added from it keep their stages exactly as they are. New deliverables can't use it any more. This can't be undone.",
      confirmLabel: "Delete Reel",
    });
    expect(templateDeleteCopy("stage_preset", "Video", { used: 0, open: 0 })).toEqual({
      title: "Delete preset “Video”?",
      description:
        "Stages already added from it stay exactly as they are. It won't be offered any more. This can't be undone.",
      confirmLabel: "Delete Video",
    });
  });
});

describe("the helpers", () => {
  it("labels a deleted template", () => {
    expect(deletedTemplateLabel("Retainer 1")).toBe("Retainer 1 (deleted)");
  });
  it("reads the database's usage safely", () => {
    expect(usageFromJson({ used: 3, open: 2, copied: 1 })).toEqual({ used: 3, open: 2 });
    expect(usageFromJson(null)).toEqual({ used: 0, open: 0 });
    expect(usageFromJson({ used: "3" })).toEqual({ used: 0, open: 0 });
  });
  it("reads the usage only for the linked kinds", () => {
    expect(deleteNeedsUsage("project")).toBe(true);
    expect(deleteNeedsUsage("task")).toBe(true);
    expect(deleteNeedsUsage("deliverable")).toBe(false);
    expect(deleteNeedsUsage("stage_preset")).toBe(false);
  });
});
