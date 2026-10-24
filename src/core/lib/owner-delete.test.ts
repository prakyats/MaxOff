import { describe, expect, it } from "vitest";

import {
  deleteNeedsUsage,
  deletedTemplateLabel,
  IN_USE_REASON,
  templateDeleteCopy,
  unusedDeleteCopy,
  unusedUsageFromJson,
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

describe("unusedDeleteCopy", () => {
  it("waits, with no commit, while the check runs", () => {
    const copy = unusedDeleteCopy("job_title", "Editor", null);
    expect(copy.canDelete).toBe(false);
    expect(copy.title).toBe("Delete job title “Editor”?");
    expect(copy.description).toBe("Checking whether anything has used it…");
  });

  it("offers the named red commit and Keep it when nothing ever used it", () => {
    expect(unusedDeleteCopy("task_type", "Reel", { used: false })).toEqual({
      title: "Delete task type “Reel”?",
      description: "Nothing has ever used it, so it goes for good. This can't be undone.",
      confirmLabel: "Delete Reel",
      cancelLabel: "Keep it",
      canDelete: true,
    });
    expect(unusedDeleteCopy("client", "Acme", { used: false }).description).toBe(
      "Nothing else uses this draft (no contact, project, task, file or note), so it goes for good. This can't be undone.",
    );
  });

  it("gives the plain reason, and only Close, when it is in use", () => {
    const copy = unusedDeleteCopy("expense_category", "Travel", { used: true });
    expect(copy.canDelete).toBe(false);
    expect(copy.cancelLabel).toBe("Close");
    expect(copy.title).toBe("“Travel” is in use");
    expect(copy.description.startsWith(IN_USE_REASON)).toBe(true);
    expect(unusedDeleteCopy("contact", "Priya", { used: true }).description).toBe(
      "In use — archive it instead. Archived contacts stay in the history and can be restored.",
    );
    expect(unusedDeleteCopy("client", "Acme", { used: true }).description).toMatch(
      /^In use — it stays\./,
    );
  });
});

describe("unusedUsageFromJson", () => {
  it("reads only an explicit false as unused", () => {
    expect(unusedUsageFromJson({ used: false })).toEqual({ used: false });
    expect(unusedUsageFromJson({ used: true })).toEqual({ used: true });
    expect(unusedUsageFromJson(null)).toEqual({ used: true });
    expect(unusedUsageFromJson({})).toEqual({ used: true });
  });
});
