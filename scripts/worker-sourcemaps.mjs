#!/usr/bin/env node
// Readable Sentry stack traces on the Worker (ROADMAP 6.6, ARCHITECTURE §18.2). Run by
// `.github/workflows/deploy.yml` after `pnpm build:worker` and before `wrangler deploy`:
//
//   node scripts/worker-sourcemaps.mjs <staging|production>
//
// 1. Puts the Worker's debug id first in `.open-next/worker.js` (`lib/worker-sourcemaps.mjs` says
//    why the chunks' own ids cannot be used).
// 2. Bundles the Worker exactly as the deploy step will (`wrangler deploy --dry-run --outdir`,
//    same wrangler, same environment, same files: esbuild's output is deterministic), with the
//    source map wrangler always writes. OpenNext's bundles carry linked maps (the
//    `patches/@opennextjs__cloudflare` patch), so that map leads back to `src/`.
// 3. Uploads that bundle and its map to Sentry under the debug id, for the release the build
//    already put on every event (`SENTRY_RELEASE`, else `GITHUB_SHA`: what `withSentryConfig`
//    reads).
// 4. Always, also when skipped or when something fails: removes every `.map` under `.open-next/`,
//    so no source map is ever deployed or served (wrangler would not upload them anyway: maps are
//    never in `.open-next/assets`, and `upload_source_maps` is off).
//
// Without SENTRY_AUTH_TOKEN (production until it is added, every local run, every preview) steps
// 1–3 are skipped. With it, only `sentry-cli` receives the token, never the wrangler dry run.
// Like the build's own upload, a failed upload never fails the deploy: it warns, and only the
// stack traces of this release stay unreadable.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  debugIdRegistration,
  prepareWorkerMap,
  stampDebugId,
  withoutSentryToken,
} from "./lib/worker-sourcemaps.mjs";

const ENVIRONMENTS = ["staging", "production"];
const root = process.cwd();
const openNextDir = path.join(root, ".open-next");

/** A line on stdout, where GitHub Actions reads `::warning::` from. */
function say(line) {
  process.stdout.write(`${line}\n`);
}

function warn(message) {
  say(`::warning::Worker source map: ${message}`);
}

/** Every `.map` file under `dir`, removed; returns how many there were. */
function removeSourceMaps(dir) {
  let removed = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".map")) {
      rmSync(path.join(entry.parentPath, entry.name));
      removed += 1;
    }
  }
  return removed;
}

/** The `sentry-cli` binary `@sentry/nextjs` installs (its build-time upload uses the same one). */
function sentryCliPath() {
  const fromNext = createRequire(
    createRequire(import.meta.url).resolve("@sentry/nextjs/package.json"),
  );
  return fromNext("@sentry/cli").getPath();
}

/** Runs a step with `env` (the token goes only to `sentry-cli`: `withoutSentryToken`). */
function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env });
  return result.status === 0;
}

function upload(environment) {
  const release = process.env.SENTRY_RELEASE || process.env.GITHUB_SHA;
  const { SENTRY_ORG: org, SENTRY_PROJECT: project } = process.env;
  if (!org || !project) {
    warn("SENTRY_ORG or SENTRY_PROJECT is not set; nothing uploaded.");
    return;
  }

  const debugId = randomUUID();
  const workerEntry = path.join(openNextDir, "worker.js");
  writeFileSync(
    workerEntry,
    `${debugIdRegistration(debugId)}\n${readFileSync(workerEntry, "utf8")}`,
  );

  const outDir = mkdtempSync(path.join(process.env.RUNNER_TEMP || tmpdir(), "worker-map-"));
  try {
    const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
    const bundled = run(
      wrangler,
      ["deploy", "--dry-run", "--env", environment, "--outdir", outDir],
      withoutSentryToken(process.env),
    );
    if (!bundled) return warn("the dry-run bundle failed; nothing uploaded.");

    const bundlePath = path.join(outDir, "index.js");
    const mapPath = `${bundlePath}.map`;
    const code = readFileSync(bundlePath, "utf8");
    if (!code.includes(debugId)) return warn("the bundle lacks its debug id; nothing uploaded.");

    const map = JSON.parse(readFileSync(mapPath, "utf8"));
    writeFileSync(
      mapPath,
      JSON.stringify(prepareWorkerMap(map, { debugId, mapDir: outDir, root })),
    );
    writeFileSync(bundlePath, stampDebugId(code, debugId));
    for (const name of readdirSync(outDir)) {
      if (name !== "index.js" && name !== "index.js.map") rmSync(path.join(outDir, name));
    }

    const args = ["sourcemaps", "upload", "--org", org, "--project", project];
    if (release) args.push("--release", release);
    const uploaded = run(sentryCliPath(), [...args, outDir], process.env);
    if (!uploaded) return warn("sentry-cli could not upload it.");
    say(`Worker source map uploaded: debug id ${debugId}, release ${release ?? "(none)"}.`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

const environment = process.argv[2];
if (!ENVIRONMENTS.includes(environment)) {
  console.error(`Usage: node scripts/worker-sourcemaps.mjs <${ENVIRONMENTS.join("|")}>`);
  process.exit(2);
}

try {
  if (process.env.SENTRY_AUTH_TOKEN) {
    upload(environment);
  } else {
    say("SENTRY_AUTH_TOKEN is not set: no Worker source map is uploaded.");
  }
} catch (error) {
  warn(error instanceof Error ? error.message : String(error));
} finally {
  say(`Source maps removed from .open-next/: ${removeSourceMaps(openNextDir)}.`);
}
