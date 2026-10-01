import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * scripts/production-migrations.sh decides from `supabase migration list` alone (deploy.yml's
 * production job). Its dry run (DRY_RUN_LIST) prints the decision and runs no supabase command,
 * so the four cases are checked here against captured listings: nothing pending, the v1.3.0
 * out-of-order case, production ahead and an unreadable listing.
 */
const dir = mkdtempSync(join(tmpdir(), "production-migrations-"));

function row(local: string | null, remote: string | null): string {
  const cell = (version: string | null) => (version ? `\`${version}\`` : "` `             ");
  return `   ${cell(local)} | ${cell(remote)} | \`2026-09-30 00:00:00\` `;
}

function listing(rows: [string | null, string | null][], bars = "|"): string {
  const table = [
    "   Local            | Remote           | Time (UTC)            ",
    "  ------------------|------------------|-----------------------",
    ...rows.map(([local, remote]) => row(local, remote)),
  ].join("\n");
  return `Connecting to remote database...\n\n${table.replaceAll("|", bars)}\n`;
}

function dryRun(name: string, text: string) {
  const file = join(dir, `${name}.txt`);
  writeFileSync(file, text);
  const run = spawnSync("bash", ["scripts/production-migrations.sh"], {
    env: {
      ...process.env,
      DRY_RUN_LIST: file,
      TMPDIR: dir,
      RUNNER_TEMP: dir,
      GITHUB_STEP_SUMMARY: "",
    },
    encoding: "utf8",
  });
  const decision = /^decision: (.*)$/m.exec(run.stdout)?.[1];
  return { status: run.status, decision, out: run.stdout };
}

const v120: [string, string][] = [
  ["20260930042642", "20260930042642"],
  ["20260930070616", "20260930070616"],
];

describe("production-migrations.sh decides from the listing", () => {
  it("skips when production has every migration of the tag", () => {
    const result = dryRun("none", listing(v120));
    expect(result).toMatchObject({ status: 0, decision: "skip (nothing pending)" });
  });

  it("applies the v1.3.0 versions that sort before production's newest, in version order", () => {
    const result = dryRun(
      "v130",
      listing([
        ["20260930042642", "20260930042642"],
        ["20260930050132", null],
        ["20260930070616", "20260930070616"],
        ["20260930073623", null],
        ["20260930180227", null],
      ]),
    );
    expect(result.status).toBe(0);
    expect(result.decision).toBe("apply 20260930050132 20260930073623 20260930180227");
  });

  it("reads the older CLI's table drawn with │", () => {
    const result = dryRun("legacy", listing([...v120, ["20260930180227", null]], "│"));
    expect(result).toMatchObject({ status: 0, decision: "apply 20260930180227" });
  });

  it("fails when production holds a version the tag lacks, even with something pending", () => {
    const result = dryRun(
      "ahead",
      listing([...v120, ["20260930180227", null], [null, "20261002090000"]]),
    );
    expect(result).toMatchObject({ status: 1, decision: "fail (production ahead)" });
    expect(result.out).toContain("20261002090000");
  });

  it("fails when the listing cannot be read", () => {
    const result = dryRun(
      "unreadable",
      "Connecting to remote database...\nfailed to connect to postgres: dial tcp: i/o timeout\n",
    );
    expect(result).toMatchObject({ status: 1, decision: "fail (listing unreadable)" });
  });
});
