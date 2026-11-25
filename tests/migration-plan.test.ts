import { describe, expect, it } from "vitest";

import { appliesStagingMigrations, previewMayBuild } from "../scripts/lib/migration-plan.mjs";

/**
 * When the Preview workflow applies staging's missing migrations (advisor 2026-11-26: a `claude/*`
 * branch previewed for hours against a staging without its migration).
 */
describe("appliesStagingMigrations", () => {
  it("runs on a push of any branch that adds a migration, and of every phase branch", () => {
    expect(appliesStagingMigrations({ event: "push", ref: "claude/hotfix-x", added: 1 })).toBe(
      true,
    );
    expect(appliesStagingMigrations({ event: "push", ref: "phase-v75", added: 0 })).toBe(true);
    expect(appliesStagingMigrations({ event: "push", ref: "claude/docs-y", added: 0 })).toBe(false);
  });

  it("runs on a manual preview only when the branch adds one; on a manual apply always", () => {
    const base = { event: "workflow_dispatch", ref: "claude/hotfix-x" };
    expect(appliesStagingMigrations({ ...base, job: "preview", added: 2 })).toBe(true);
    expect(appliesStagingMigrations({ ...base, job: "preview", added: 0 })).toBe(false);
    expect(appliesStagingMigrations({ ...base, job: "staging-migrations", added: 0 })).toBe(true);
    expect(appliesStagingMigrations({ ...base, job: "perf-probe", added: 3 })).toBe(false);
  });

  it("never for main (the staging deploy applies its migrations)", () => {
    expect(appliesStagingMigrations({ event: "push", ref: "main", added: 4 })).toBe(false);
    expect(
      appliesStagingMigrations({
        event: "workflow_dispatch",
        ref: "main",
        job: "staging-migrations",
        added: 0,
      }),
    ).toBe(false);
  });
});

describe("previewMayBuild", () => {
  it("needs this run's apply to have succeeded when the branch adds migrations", () => {
    expect(previewMayBuild({ added: 1, migrations: "success" })).toBe(true);
    expect(previewMayBuild({ added: 1, migrations: "skipped" })).toBe(false);
    expect(previewMayBuild({ added: 1, migrations: "failure" })).toBe(false);
    expect(previewMayBuild({ added: 1, migrations: "cancelled" })).toBe(false);
  });

  it("builds without migrations of its own whether or not the job ran", () => {
    expect(previewMayBuild({ added: 0, migrations: "skipped" })).toBe(true);
    expect(previewMayBuild({ added: 0, migrations: "success" })).toBe(true);
    expect(previewMayBuild({ added: 0, migrations: "failure" })).toBe(false);
  });
});
