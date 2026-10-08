import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  debugIdRegistration,
  normalizeSource,
  prepareWorkerMap,
  stampDebugId,
  withoutSentryToken,
} from "../scripts/lib/worker-sourcemaps.mjs";

/**
 * `scripts/worker-sourcemaps.mjs` (deploy.yml's source-map step, ARCHITECTURE §18.2): the
 * Worker's debug id must be the only one the Sentry SDK can find for the Worker file, the map
 * must read `src/…`, and no `.map` may be left in `.open-next/` for the deploy.
 */
const ID = "bfe12c77-4c6f-4344-8756-f7d8186b9b79";

/** Turbopack's own registration, as every chunk of a `debugIds: true` build starts with it. */
function turbopackRegistration(debugId: string): string {
  return `;!function(){try { var e="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof window?window:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&((e._debugIds|| (e._debugIds={}))[n]="${debugId}")}catch(e){}}();`;
}

describe("debugIdRegistration", () => {
  it("replaces the ids chunks registered before it and keeps out those registered after", () => {
    const context: { _debugIds?: Record<string, string> } = {};
    runInNewContext(
      [
        turbopackRegistration("11111111-1111-4111-8111-111111111111"),
        debugIdRegistration(ID),
        turbopackRegistration("22222222-2222-4222-8222-222222222222"),
        `"use strict";${turbopackRegistration("33333333-3333-4333-8333-333333333333")}`,
      ].join("\n"),
      context,
    );
    expect(Object.values(context._debugIds ?? {})).toEqual([ID]);
  });

  it("keys the id by a stack, as the SDK reads a file name from it", () => {
    const context: { _debugIds?: Record<string, string> } = {};
    runInNewContext(debugIdRegistration(ID), context, { filename: "index.js" });
    const [key] = Object.keys(context._debugIds ?? {});
    expect(key).toContain("index.js:1:");
  });

  it("refuses anything that is not a debug id", () => {
    expect(() => debugIdRegistration('x"});alert(1);//')).toThrow("Not a debug id");
    expect(() => debugIdRegistration(ID.toUpperCase())).toThrow("Not a debug id");
  });
});

describe("prepareWorkerMap", () => {
  const root = "/repo";
  const mapDir = "/runner/tmp/worker-map-1";
  const fromOut = (path: string) => `../../../repo/${path}`;
  const map = {
    version: 3,
    sources: [
      fromOut(".open-next/server-functions/default/src/core/observability/diagnostic.ts"),
      fromOut(".open-next/middleware/src/proxy.ts"),
      fromOut(".open-next/server-functions/default/node_modules/.pnpm/next/dist/server.js"),
      fromOut("worker/index.js"),
      "node-built-in-modules:node:crypto",
    ],
    sourcesContent: ["throw new Error()", null, "next's code", "export default {}", ""],
    mappings: "AAAA",
    names: [],
  };

  it("reads every source from the repository root, without OpenNext's copies", () => {
    expect(prepareWorkerMap(map, { debugId: ID, mapDir, root }).sources).toEqual([
      "src/core/observability/diagnostic.ts",
      "src/proxy.ts",
      "node_modules/.pnpm/next/dist/server.js",
      "worker/index.js",
      "node-built-in-modules:node:crypto",
    ]);
  });

  it("keeps the content of the app's own sources only", () => {
    expect(prepareWorkerMap(map, { debugId: ID, mapDir, root }).sourcesContent).toEqual([
      "throw new Error()",
      null,
      null,
      null,
      null,
    ]);
  });

  it("carries the debug id under both names sentry-cli reads, and leaves the input alone", () => {
    const prepared = prepareWorkerMap(map, { debugId: ID, mapDir, root });
    expect(prepared).toMatchObject({ debug_id: ID, debugId: ID, mappings: "AAAA" });
    expect(map.sources[0]).toBe(
      fromOut(".open-next/server-functions/default/src/core/observability/diagnostic.ts"),
    );
  });

  it("leaves a source that is not a path as it is", () => {
    expect(normalizeSource("turbopack:///[project]/src/a.ts", { mapDir, root })).toBe(
      "turbopack:///[project]/src/a.ts",
    );
  });
});

describe("stampDebugId", () => {
  it("adds the comment after the code, so no line or column moves", () => {
    const code = "a();\nb();\n//# sourceMappingURL=index.js.map";
    const stamped = stampDebugId(code, ID);
    expect(stamped.startsWith(code)).toBe(true);
    expect(stamped.endsWith(`\n//# debugId=${ID}\n`)).toBe(true);
  });
});

describe("withoutSentryToken", () => {
  it("drops the Sentry token and keeps everything else, leaving the original as it was", () => {
    const env = { SENTRY_AUTH_TOKEN: "secret", SENTRY_ORG: "pixora", PATH: "/bin" };
    expect(withoutSentryToken(env)).toEqual({ SENTRY_ORG: "pixora", PATH: "/bin" });
    expect(env.SENTRY_AUTH_TOKEN).toBe("secret");
  });
});

describe("scripts/worker-sourcemaps.mjs", () => {
  const script = resolve("scripts/worker-sourcemaps.mjs");

  function runIn(cwd: string, args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.SENTRY_AUTH_TOKEN;
    return spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: "utf8" });
  }

  it("without SENTRY_AUTH_TOKEN uploads nothing and still removes every source map", () => {
    const cwd = mkdtempSync(join(tmpdir(), "worker-sourcemaps-"));
    const files = [
      ".open-next/assets/_next/static/chunks/app.js.map",
      ".open-next/server-functions/default/handler.mjs.map",
      ".open-next/middleware/handler.mjs.map",
    ];
    for (const file of files) {
      mkdirSync(join(cwd, file, ".."), { recursive: true });
      writeFileSync(join(cwd, file), "{}");
    }
    writeFileSync(join(cwd, ".open-next/worker.js"), "export default {};\n");

    const run = runIn(cwd, ["staging"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("SENTRY_AUTH_TOKEN is not set");
    expect(run.stdout).toContain("Source maps removed from .open-next/: 3.");
    for (const file of files) expect(existsSync(join(cwd, file))).toBe(false);
    expect(existsSync(join(cwd, ".open-next/worker.js"))).toBe(true);
  });

  it("never hands the Sentry token to the wrangler dry run (least privilege)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "worker-sourcemaps-"));
    mkdirSync(join(cwd, ".open-next"), { recursive: true });
    writeFileSync(join(cwd, ".open-next/worker.js"), "export default {};\n");
    // A stand-in wrangler that records the environment it was given, then fails, so the script
    // stops before sentry-cli (nothing leaves this machine).
    const bin = join(cwd, "node_modules/.bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "wrangler"), '#!/bin/sh\nenv > "$PWD/wrangler-env.txt"\nexit 1\n');
    chmodSync(join(bin, "wrangler"), 0o755);

    const run = spawnSync(process.execPath, [script, "staging"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        SENTRY_AUTH_TOKEN: "sntrys_fake_token",
        SENTRY_ORG: "pixora",
        SENTRY_PROJECT: "maxoff",
      },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("the dry-run bundle failed");
    const seen = readFileSync(join(cwd, "wrangler-env.txt"), "utf8");
    expect(seen).toContain("SENTRY_ORG=pixora");
    expect(seen).not.toContain("SENTRY_AUTH_TOKEN");
    expect(seen).not.toContain("sntrys_fake_token");
  });

  it("refuses an unknown environment", () => {
    const run = runIn(tmpdir(), ["preview"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Usage");
  });
});
