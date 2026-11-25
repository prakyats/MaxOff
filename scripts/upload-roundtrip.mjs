#!/usr/bin/env node
// v4.5 upload link, end to end on STAGING (the upload unit; advisor, 25 Nov 2026). Run by the
// Preview workflow's dispatch-only `upload-roundtrip` job against this branch's preview, never
// production. Real everything: the app's own screens, the studio's TEST Gmail Drive the Owner
// connected on staging (never the studio account), Google's resumable sessions.
//
//   1. Signs in as the staging Owner the way `perf-probe.mjs` does (a magic link minted with the
//      staging service key and never sent) and makes one test task as that member, through
//      `task_create` with the member's own session: the Owner is its only person, so nobody else
//      is told, and it has no client (it files under Internal/ in the test Drive).
//   2. Opens the task on the preview and taps Get upload link; the link is masked in the log
//      (::add-mask::) and never printed.
//   3. In a fresh browser (no session), opens the link, types a name, and sends three small
//      generated files and a two-file folder, then waits for every row to say Done.
//   4. Reads that task's upload rows with the service key, read-only: every file done, its size,
//      the checksum kind, and the page's MD5 equal to Drive's. Prints counts only.
//   5. Back as the Owner, taps All files received (the Owner's own task: it completes, 6b.2).
//
// Environment (the staging GitHub environment): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
// SUPABASE_SECRET_KEY, BASE (the preview's https *.workers.dev address).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

/** Production's Supabase project (README → "Deploying"): never signed in to from here. */
const PRODUCTION_PROJECT_REF = "peshoflxypujbzecgwqq";

/** The test Gmail was connected on staging after this (the owner, 25 Nov 2026, ~15:40 UTC). */
const TEST_CONNECT_AFTER = "2026-11-25T15:00:00Z";

const results = [];
const record = (step, ok, detail) => {
  results.push({ step, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"} | ${step} | ${detail}\n`);
};
const mask = (value) => process.stdout.write(`::add-mask::${value}\n`);

function guard(base, supabaseUrl) {
  const { protocol, hostname } = new URL(base);
  if (
    protocol !== "https:" ||
    !hostname.endsWith(".workers.dev") ||
    !hostname.includes("maxoff-staging")
  ) {
    throw new Error(
      `Only a staging preview (https, *maxoff-staging*.workers.dev), not ${hostname}.`,
    );
  }
  if (new URL(supabaseUrl).hostname.startsWith(`${PRODUCTION_PROJECT_REF}.`)) {
    throw new Error("Never on production's Supabase project.");
  }
}

/** The staging Owner's session, as perf-probe.mjs mints it. */
async function ownerSession(url, publishableKey, secretKey) {
  const anon = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const service = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await service
    .from("members")
    .select("id, email")
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1);
  if (error) throw new Error(`members read failed: ${error.message}`);
  const member = data?.[0];
  if (!member) throw new Error("no active Owner on staging");
  const link = await service.auth.admin.generateLink({ type: "magiclink", email: member.email });
  if (link.error) throw new Error(`generateLink failed: ${link.error.message}`);
  const verified = await anon.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error) throw new Error(`verifyOtp failed: ${verified.error.message}`);
  return { session: verified.data.session, memberId: member.id, service };
}

/** The session as the browser's cookies (the app's own writer, `@supabase/ssr`). */
async function cookiesFor(url, publishableKey, session, host) {
  const jar = new Map();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new Error(`setSession failed: ${error.message}`);
  return [...jar].map(([name, value]) => ({
    name,
    value: encodeURIComponent(value),
    domain: host,
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: "Lax",
  }));
}

/** A member's own call (PostgREST with the member's token: RLS and the function's checks apply). */
async function asMember(url, publishableKey, session, path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

/** Small files with random bytes, and their MD5s, in a folder of their own. */
function makeFiles() {
  const root = join(
    process.env.RUNNER_TEMP ?? tmpdir(),
    `upload-roundtrip-${randomBytes(4).toString("hex")}`,
  );
  const loose = join(root, "loose");
  const folder = join(root, "Day 1");
  mkdirSync(loose, { recursive: true });
  mkdirSync(join(folder, "CAM A"), { recursive: true });
  const files = [];
  const write = (path, size) => {
    const bytes = randomBytes(size);
    writeFileSync(path, bytes);
    files.push({ path, size, md5: createHash("md5").update(bytes).digest("hex") });
  };
  // One spans more than one 256 KiB chunk boundary so the engine's chunking is exercised.
  write(join(loose, "roundtrip-a.bin"), 300_000);
  write(join(loose, "roundtrip-b.bin"), 40_000);
  write(join(loose, "roundtrip-c.bin"), 9_000);
  write(join(folder, "CAM A", "clip-1.bin"), 60_000);
  write(join(folder, "CAM A", "clip-2.bin"), 20_000);
  return { loose: files.slice(0, 3).map((f) => f.path), folder, files };
}

async function main() {
  const base = new URL(env("BASE")).origin;
  const url = env("SUPABASE_URL");
  const publishableKey = env("SUPABASE_PUBLISHABLE_KEY");
  guard(base, url);

  // 1. The Owner, and the test task.
  const { session, memberId, service } = await ownerSession(
    url,
    publishableKey,
    env("SUPABASE_SECRET_KEY"),
  );
  record("sign in", true, "the staging Owner (magic link, never sent)");

  // Only the TEST Gmail (advisor, 25 Nov 2026): the Drive the Owner connected on staging for the
  // v4.5 checks, after 15:00 UTC that day; never an older connection (the address stays out of the
  // repo, so the time is the test). Nothing about the account is printed.
  const { data: drive, error: driveError } = await service
    .from("drive_account")
    .select("state, connected_at")
    .limit(2);
  if (driveError) throw new Error(`drive_account read failed: ${driveError.message}`);
  const connected = drive?.length === 1 && drive[0].state === "connected" ? drive[0] : null;
  if (!connected || Date.parse(connected.connected_at) < Date.parse(TEST_CONNECT_AFTER)) {
    throw new Error(
      "The staging Drive is not the test connection made after 25 Nov 2026 15:00 UTC.",
    );
  }
  record("test Drive", true, "connected after 25 Nov 15:00 UTC (the test Gmail)");
  const [type] = await asMember(
    url,
    publishableKey,
    session,
    "task_types?archived_at=is.null&select=id&order=position.asc&limit=1",
  );
  if (!type) throw new Error("no task type on staging");
  // A deadline three days out for a throwaway test task, never a business date (ADR-0008 is about
  // those); a plain script has no `@/core/time`.
  // eslint-disable-next-line no-restricted-syntax -- a test task's deadline, not a business date.
  const due = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
  const title = `Upload round trip (CI) ${process.env.GITHUB_RUN_ID ?? "local"}`;
  const taskId = await asMember(url, publishableKey, session, "rpc/task_create", {
    method: "POST",
    body: JSON.stringify({
      title,
      description: "Made by the Preview workflow's upload-roundtrip job (v4.5). Safe to ignore.",
      task_type_id: type.id,
      client_id: null,
      priority: "low",
      due_at: due,
      assignee_ids: [memberId],
      primary_owner_id: memberId,
      approving_admin_id: null,
      stages: [],
    }),
  });
  record("test task", typeof taskId === "string", "made as the Owner, the Owner its only person");

  const browser = await chromium.launch();
  try {
    // 2. Get upload link, on the app's own screen.
    const member = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await member.addCookies(await cookiesFor(url, publishableKey, session, new URL(base).hostname));
    const app = await member.newPage();
    await app.goto(`${base}/tasks/${taskId}`, { waitUntil: "networkidle" });
    const card = app.locator('[data-slot="uploads-card"][data-live]');
    await card.waitFor({ timeout: 30_000 });
    await card.getByRole("button", { name: "Get upload link" }).click();
    const field = card.getByRole("textbox", { name: "Upload link" });
    await field.waitFor({ timeout: 30_000 });
    const link = await field.inputValue();
    const token = new URL(link).hash.slice(1);
    mask(token);
    mask(link);
    record("get link", token.length === 43, "a 43-character token, masked");

    // 3. The uploader: no session, a name, the files and the folder.
    const { loose, folder, files } = makeFiles();
    const uploader = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await uploader.newPage();
    const seen = [];
    page.on("request", (request) => seen.push(request.url()));
    // The preview's own origin, so Google's session is opened for it (the link names staging's).
    await page.goto(`${base}/upload#${token}`);
    await page.getByLabel("Your name").fill("Round trip");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator('input[aria-label="Choose files"]').setInputFiles(loose);
    await page.locator('input[aria-label="Choose a folder"]').setInputFiles(folder);
    await page.getByRole("button", { name: /^Upload \d+ files?$/ }).click();
    await page.locator('[data-slot="upload-received"]').waitFor({ timeout: 180_000 });
    record("upload", true, `${files.length} files received on the page`);
    record(
      "token in no URL",
      seen.every((at) => !at.includes(token)),
      `${seen.length} requests checked`,
    );
    await page.getByRole("button", { name: "I'm done" }).click();
    await page.locator('[data-slot="upload-thanks"]').waitFor({ timeout: 30_000 });
    record("I'm done", true, "the thanks screen");

    // 4. What MaxOff recorded, read-only.
    const { data: rows, error } = await service
      .from("upload_files")
      .select("state, size_bytes, check_kind, md5_page, md5_drive, relative_path")
      .eq("task_id", taskId);
    if (error) throw new Error(`upload_files read failed: ${error.message}`);
    const done = rows.filter((row) => row.state === "done");
    record("all done", done.length === files.length, `${done.length} of ${files.length} done`);
    const sizes = files
      .map((f) => f.size)
      .sort((a, b) => a - b)
      .join(",");
    const recorded = rows
      .map((row) => Number(row.size_bytes))
      .sort((a, b) => a - b)
      .join(",");
    record("sizes", sizes === recorded, "every size as sent");
    const md5ok = done.filter(
      (row) => row.check_kind === "md5" && row.md5_page && row.md5_page === row.md5_drive,
    );
    record(
      "checksums",
      md5ok.length === files.length,
      `${md5ok.length} with the page's MD5 = Drive's`,
    );
    const ours = new Set(files.map((f) => f.md5));
    record(
      "bytes",
      done.every((row) => ours.has(row.md5_drive)),
      "Drive holds exactly the bytes sent",
    );
    const foldered = rows.filter((row) => row.relative_path === "Day 1/CAM A").length;
    record("folder", foldered === 2, `${foldered} of 2 kept their folder`);

    // 5. All files received, as the Owner (their own task: it completes).
    await app.reload({ waitUntil: "networkidle" });
    await card.waitFor({ timeout: 30_000 });
    await app.locator('[data-slot="uploads-received"]').click();
    const sheet = app.getByRole("alertdialog");
    await sheet.getByRole("button", { name: /Received, mark Done|Files received/ }).click();
    await app
      .locator('[data-slot="uploads-card"][data-state="stopped"]')
      .waitFor({ timeout: 30_000 });
    record("all files received", true, "the link stopped");
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    record("run", false, error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    process.stdout.write(
      failed === 0 ? "Upload round trip: PASS\n" : `Upload round trip: FAIL (${failed})\n`,
    );
    process.exitCode = failed === 0 ? 0 : 1;
  });
