#!/usr/bin/env node
// Times what the Worker answers, route by route, from wherever this runs (unit P, 2026-10-15:
// "the app has become slow after v1.7.0"), and holds the v1.8 speed gate. Run by the Preview
// workflow's `perf-probe` job (`.github/workflows/preview.yml`, Actions → Preview → Run
// workflow → `perf-probe`) from a GitHub runner against a branch preview and against staging,
// and by hand:
//
//   node scripts/perf-probe.mjs --base https://phase-x-maxoff-staging.<sub>.workers.dev
//                               [--samples 5] [--role owner] [--label "phase-x @ abc1234"]
//                               [--project <id>] [--client <id>] [--task <id>] [--person <id>]
//                               [--out probe.json] [--no-signin]
//                               [--compare-to staging.json] [--candidate branch.json]
//                               [--pair https://maxoff-staging.<sub>.workers.dev --pair-out staging.json]
//
// Environment: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (the project the Worker talks to) and
// one way to sign in: PROBE_EMAIL + PROBE_PASSWORD (GoTrue's password grant, no secret), or
// SUPABASE_SECRET_KEY (the service key: the first active member of `--role` gets a session
// through a magic link that is never sent; PROBE_EMAIL picks the member). **Staging only** with
// a session; production only with `--no-signin` (the public routes, no key in the environment).
// Read-only: every request is a GET (the sign-in itself is GoTrue's, on the staging project).
//
// Routes: the public ones, then every main signed-in route (`scripts/lib/perf-gate.mjs`:
// each role's tabs and More items, Me, the bell, and one task, client, project and person the
// signed-in member can see, picked through that member's own session; no fixed ids). A route
// the member's role can't open, or a record it has none of, is a "skipped" row in the table.
//
// The speed gate (`scripts/lib/perf-gate.mjs` holds the thresholds): a route fails when its
// warm TTFB p50 is above 600 ms, when it answered with another status than its own, or, with a
// staging compare, when it is slower than staging by more than 100 ms, or by more than 10 % and at
// least 50 ms (more than 10 % under 50 ms is a WARN, shown but not failing; /api/warm is shown
// and never judged; see scripts/lib/perf-gate.mjs). The
// table's Gate column says PASS / FAIL / SKIP with the reason, a summary line follows, each
// failing route is a `::error::` annotation, and the process exits 1. The compare:
//   --pair <base>        (the workflow's way) staging is probed in the same run, request by
//                        request after this base, and the gate judges this base against it
//                        (staging's own rows are printed for reference, not gated);
//   --compare-to <file>  this run is the candidate; the file is staging's `--out`;
//   --candidate <file>   this run is staging; the file is the candidate's `--out`, and the gate
//                        judges the candidate (staging's own rows are printed, not gated).
//
// For every route it makes `--samples` requests on a **fresh** connection (DNS + TLS each time,
// the way a first open or the advisor's curl lands: often on an isolate that has not run the
// Worker yet) and `--samples` on **one kept-alive** connection (the way a phone taps around:
// the same metal, usually a warm isolate). Reported per route and connection kind:
//   ttfb     first byte of the response − the request's start, the median and the spread
//   server   ttfb − the time to a ready TLS connection: the Worker's own time plus one round trip
//   total    the whole body (a streamed page: its loading screen is in the first flush, the
//            data in the rest)
//   cold     how many samples hit an isolate on its first request (`Server-Timing: isolate`
//            from the proxy, `n=1`), the one number that separates a cold start from a slow one
//   claims   the proxy's session verification, from the same header
//   colo     the Cloudflare location that ran the Worker (`cf-ray`'s suffix)
// `/diagnostics/timing` (member-only JSON, numbers only) adds the layout's own chain measured on
// the Worker: claims, then the one wave (P2): the member row, the push status, the counts (`session_bundle()`)
// and the own-day read, each from the wave's start, and the wave itself, in ms.
//
// Where this runs matters: a GitHub runner sits in the US, so every Worker → Supabase (Mumbai)
// round trip costs ~200 ms there against a few tens from India. That exaggerates a waterfall
// (good: it shows) and says nothing about the owner's absolute numbers; the `colo` column says
// where the Worker ran, and the same script from India gives the real ones.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

import { judgeRun, median, planMemberRoutes, summaryLine } from "./lib/perf-gate.mjs";

const require = createRequire(import.meta.url);

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, arg, i, all) =>
        arg.startsWith("--")
          ? [
              ...pairs,
              [arg.slice(2), all[i + 1]?.startsWith("--") ? "true" : (all[i + 1] ?? "true")],
            ]
          : pairs,
      [],
    ),
);
if (!args.base) throw new Error("--base is required");
const base = args.base.replace(/\/$/, "");
const samples = Number(args.samples ?? 5);
const role = args.role ?? "owner";
const label = args.label ?? base;
const signIn = args["no-signin"] !== "true";
// `--pair <staging>` (2026-10-23): probe staging in the same run, each request right after the
// candidate's (branch, staging, branch, …), so both sides share the same minutes of Worker and
// database load. Probing them one after the other let a slow spell land on one side only: the
// Admin compare failed by a flat ~140 ms on routes that changed from run to run, while the
// Worker's own chain (`/diagnostics/timing`) timed the same on both. `--pair-out` keeps staging's rows.
const pairBase = args.pair ? args.pair.replace(/\/$/, "") : null;
const pairLabel = args["pair-label"] ?? "staging (main)";
const bases = pairBase ? [base, pairBase] : [base];

const env = {
  url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey:
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  secretKey: process.env.SUPABASE_SECRET_KEY,
  email: process.env.PROBE_EMAIL,
  password: process.env.PROBE_PASSWORD,
};
// Production is probed signed out only (`--no-signin`: the static asset, the 404, health, /login),
// never with a session and never with a key in the environment.
if (signIn && bases.some((at) => /maxoff\.in|^https:\/\/maxoff\.pixoraclips/.test(at))) {
  throw new Error("Never probe production with a signed-in session: use --no-signin.");
}
/** Production's Supabase project (`maxoff-production`, Mumbai; README → "Deploying"). */
const PRODUCTION_PROJECT_REF = "peshoflxypujbzecgwqq";
if (signIn) {
  // A session is minted only on a project that is not production's, and sent only to staging, a
  // preview of it (both `*.workers.dev`) or this machine: never to any other host.
  const project = env.url ? new URL(env.url).hostname : "";
  if (
    project === `${PRODUCTION_PROJECT_REF}.supabase.co` ||
    project.startsWith(`${PRODUCTION_PROJECT_REF}.`)
  ) {
    throw new Error("Never sign in on production's Supabase project: use --no-signin.");
  }
  for (const at of bases) {
    const { protocol, hostname } = new URL(at);
    const local = hostname === "localhost" || hostname === "127.0.0.1";
    const workers = protocol === "https:" && hostname.endsWith(".workers.dev");
    if (!local && !workers) {
      throw new Error(
        `A signed-in probe goes only to a *.workers.dev address over https or to localhost, not ${hostname}: use --no-signin.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Sign in: a session for one member, as the browser would hold it (the same cookie writer the
// app uses, `@supabase/ssr`), then the ids the signed-in routes need.
// ---------------------------------------------------------------------------------------------
async function mintSession() {
  if (!env.url || !env.publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required to sign in.");
  }
  const { createClient } = require("@supabase/supabase-js");
  const anon = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  if (env.email && env.password) {
    const { data, error } = await anon.auth.signInWithPassword({
      email: env.email,
      password: env.password,
    });
    if (error) throw new Error(`password sign-in failed: ${error.message}`);
    return { session: data.session, email: env.email };
  }

  if (!env.secretKey) {
    throw new Error("Set PROBE_EMAIL + PROBE_PASSWORD, or SUPABASE_SECRET_KEY, to sign in.");
  }
  const service = createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let email = env.email;
  if (!email) {
    const { data, error } = await service
      .from("members")
      .select("email")
      .eq("role", role)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(`members read failed: ${error.message}`);
    email = data?.[0]?.email;
    if (!email) throw new Error(`no active ${role} on this project`);
  }
  const link = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`generateLink failed: ${link.error.message}`);
  const verified = await anon.auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error) throw new Error(`verifyOtp failed: ${verified.error.message}`);
  return { session: verified.data.session, email };
}

/** The `Cookie` header `@supabase/ssr` would make the browser send for this session. */
async function cookieHeaderFor(session) {
  const { createServerClient } = require("@supabase/ssr");
  const jar = new Map();
  const client = createServerClient(env.url, env.publishableKey, {
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
  if (jar.size === 0) throw new Error("@supabase/ssr wrote no cookie for the session");
  return [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
}

/**
 * The signed-in member's role and one record of each kind for the detail routes, read with the
 * member's own session (RLS decides what it sees; no fixed ids). A read the role is refused is
 * no record, and the route is a skipped row.
 */
async function pickIds(session) {
  const headers = {
    apikey: env.publishableKey,
    authorization: `Bearer ${session.access_token}`,
  };
  const read = async (query) => {
    const response = await fetch(`${env.url}/rest/v1/${query}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    return response.json();
  };
  const self = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url")).sub;
  const me = (await read(`members?select=id,role&id=eq.${self}`))[0];
  if (!me) throw new Error("the signed-in member's own row is not readable");
  const task =
    args.task ??
    (await read("tasks?select=id&archived_at=is.null&order=created_at.desc&limit=1"))[0]?.id;
  const client =
    args.client ??
    (await read("clients?select=id&state=eq.active&order=created_at.asc&limit=1"))[0]?.id;
  const project = args.project
    ? ((await read(`projects?select=id,client_id&id=eq.${args.project}`))[0] ?? null)
    : (
        await read("projects?select=id,client_id&archived_at=is.null&order=created_at.desc&limit=1")
      )[0];
  const person =
    args.person ??
    (
      await read(`members?select=id&status=eq.active&id=neq.${self}&order=created_at.asc&limit=1`)
    )[0]?.id ??
    self;
  return {
    role: me.role,
    ids: {
      task: task ?? null,
      client: client ?? null,
      project: project?.id ?? null,
      projectClient: project?.client_id ?? null,
      person: person ?? null,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// One request, timed from this process: connection phases from the socket's events, the first
// byte from the response headers, the whole body from `end`.
// ---------------------------------------------------------------------------------------------
function request(url, { agent, headers }) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let connected = 0;
    let secured = 0;
    let reused = false;
    // GET only: the probe reads screens and never writes.
    const req = transport.request(url, { method: "GET", agent, headers }, (res) => {
      const ttfb = performance.now() - start;
      let bytes = 0;
      res.on("data", (chunk) => {
        bytes += chunk.length;
      });
      res.on("end", () => {
        const serverTiming = res.headers["server-timing"] ?? "";
        resolve({
          status: res.statusCode,
          ttfb,
          total: performance.now() - start,
          connect: reused ? 0 : secured || connected,
          reused,
          bytes,
          ray: String(res.headers["cf-ray"] ?? ""),
          colo: String(res.headers["cf-ray"] ?? "").split("-")[1] ?? "",
          timing: parseServerTiming(serverTiming),
          location: res.headers.location ?? null,
        });
      });
    });
    req.on("socket", (socket) => {
      reused = !socket.connecting && socket.readyState === "open";
      if (reused) return;
      socket.once("connect", () => {
        connected = performance.now() - start;
      });
      socket.once("secureConnect", () => {
        secured = performance.now() - start;
      });
    });
    req.on("error", reject);
    // A request that never answers (a dropped connection on a cold isolate, run 38776216005
    // hung 20 min) is one failed sample, not a hung probe.
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("timed out")));
    req.end();
  });
}

const REQUEST_TIMEOUT_MS = 30_000;
/** `http` for this machine's `pnpm start`, `https` everywhere else. */
const transport = new URL(base).protocol === "http:" ? http : https;

/** `Server-Timing: claims;dur=12, isolate;desc="n=1 age=0"` → `{ claims: 12, n: 1, age: 0 }`. */
function parseServerTiming(value) {
  const out = {};
  for (const metric of String(value).split(",")) {
    const [name, ...params] = metric.trim().split(";");
    if (!name) continue;
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq < 0) continue;
      const key = param.slice(0, eq);
      const raw = param.slice(eq + 1);
      const unquoted = (raw ?? "").replace(/^"|"$/g, "");
      if (key === "dur") out[name] = Number(unquoted);
      if (key === "desc") {
        for (const pair of unquoted.split(" ")) {
          const [k, v] = pair.split("=");
          if (k && v !== undefined) out[k] = Number.isNaN(Number(v)) ? v : Number(v);
        }
      }
    }
  }
  return out;
}

/** A sample that failed or timed out: status 0, the timeout as its time, so the table shows it. */
function failed(error) {
  process.stderr.write(`sample failed: ${error instanceof Error ? error.message : error}\n`);
  return {
    status: 0,
    ttfb: REQUEST_TIMEOUT_MS,
    total: REQUEST_TIMEOUT_MS,
    connect: 0,
    reused: false,
    bytes: 0,
    ray: "",
    colo: "",
    timing: {},
    location: null,
  };
}

async function json(url, headers) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => ({ ok: false, status: 0 }));
  if (!response.ok) return { status: response.status };
  return response.json();
}

const ms = (value) => `${Math.round(value)}`;
const range = (values) =>
  values.length === 0 ? "" : `${ms(Math.min(...values))}–${ms(Math.max(...values))}`;

/** A probe's `--out` file, for the staging compare. */
function readRun(file) {
  const run = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(run.summary)) {
    throw new Error(`${file} has no route summary: probe it again with this script.`);
  }
  return run;
}

/** The staging compare's other run, from an earlier run's `--out` (`--pair` probes it live). */
function compareFiles() {
  if (args["compare-to"]) return { baseline: readRun(args["compare-to"]) };
  if (args.candidate) return { candidate: readRun(args.candidate) };
  return {};
}

// ---------------------------------------------------------------------------------------------
async function main() {
  let cookie = null;
  let ids = {};
  let memberRole = null;
  let who = "signed out";
  if (signIn) {
    const { session, email } = await mintSession();
    cookie = await cookieHeaderFor(session);
    ({ role: memberRole, ids } = await pickIds(session));
    const [, payload] = session.access_token.split(".");
    const header = JSON.parse(Buffer.from(session.access_token.split(".")[0], "base64url"));
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    who = `${email} (${memberRole}; JWT ${claims.role ?? "?"}, ${header.alg}${
      header.alg?.startsWith("HS") ? ": symmetric, getClaims() asks GoTrue every time" : ""
    })`;
  }
  // Read before probing, so a bad file stops the run before minutes of requests.
  const compare = pairBase ? {} : compareFiles();

  // Production (advisor, 2026-10-15): the public routes UptimeRobot-style only, read-only.
  const production = /maxoff\.in|^https:\/\/maxoff\.pixoraclips/.test(base);
  /** @type {{ name: string, path?: string, auth?: boolean, expect?: number[], skip?: string }[]} */
  const plan = [
    { name: "static (no Worker)", path: "/manifest.webmanifest", auth: false },
    ...(production
      ? []
      : // Signed out, the proxy sends an unknown path to /login (307); signed in it is a 404.
        [
          {
            name: "404 (Worker, no data)",
            path: "/__perf-probe-nope",
            auth: false,
            expect: [307, 404],
          },
        ]),
    { name: "/api/health", path: "/api/health", auth: false },
    // The warm-up the app sends when it comes back into view (P2, ARCHITECTURE §19): no data, no
    // database; with the session's cookie when there is one, as the app sends it.
    { name: "/api/warm", path: "/api/warm", auth: true },
    { name: "/login", path: "/login", auth: false },
    ...(cookie ? planMemberRoutes(memberRole, ids).map((r) => ({ ...r, auth: true })) : []),
  ];
  const routes = plan.filter((route) => route.path !== undefined);

  const headersFor = (route) => ({
    "user-agent": "maxoff-perf-probe",
    accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    ...(route.auth && cookie ? { cookie } : {}),
  });
  const Agent = transport.Agent;

  const results = [];
  // Fresh connections, routes interleaved so no route gets every warm isolate or every cold one;
  // with `--pair`, each request goes to every base in turn.
  for (let i = 0; i < samples; i++) {
    for (const route of routes) {
      for (const at of bases) {
        const agent = new Agent({ keepAlive: false });
        const r = await request(at + route.path, { agent, headers: headersFor(route) }).catch(
          failed,
        );
        agent.destroy();
        results.push({ ...r, route: route.name, kind: "fresh", base: at });
      }
    }
  }
  // One kept-alive connection per base for everything: a warm Worker, the way a phone taps around.
  const keep = new Map(bases.map((at) => [at, new Agent({ keepAlive: true, maxSockets: 1 })]));
  for (const at of bases) {
    await request(at + "/manifest.webmanifest", {
      agent: keep.get(at),
      headers: headersFor(routes[0]),
    }).catch(failed);
  }
  for (let i = 0; i < samples; i++) {
    for (const route of routes) {
      for (const at of bases) {
        const r = await request(at + route.path, {
          agent: keep.get(at),
          headers: headersFor(route),
        }).catch(failed);
        results.push({ ...r, route: route.name, kind: "reused", base: at });
      }
    }
  }
  for (const agent of keep.values()) agent.destroy();

  // The layout's chain as the Worker itself timed it.
  const chains = new Map(bases.map((at) => [at, null]));
  if (cookie) {
    const reads = new Map(bases.map((at) => [at, []]));
    for (let i = 0; i < samples; i++) {
      for (const at of bases) {
        reads.get(at).push(await json(at + "/diagnostics/timing", headersFor({ auth: true })));
      }
    }
    for (const at of bases) {
      chains.set(
        at,
        reads.get(at).filter((r) => r && typeof r.total === "number"),
      );
    }
  }

  const ofBase = (at) => results.filter((r) => r.base === at);
  const own = report(
    { plan, who, base, label, results: ofBase(base), chain: chains.get(base) },
    { compare, out: args.out, gateLine: !pairBase },
  );
  // With `--pair`, staging's run prints its own rows for reference and judges this one.
  const { judgements } = pairBase
    ? report(
        {
          plan,
          who,
          base: pairBase,
          label: pairLabel,
          results: ofBase(pairBase),
          chain: chains.get(pairBase),
        },
        { compare: { candidate: { label, summary: own.summary } }, out: args["pair-out"] },
      )
    : own;

  const failing = judgements.filter((j) => j.verdict === "FAIL");
  for (const j of failing) {
    process.stderr.write(`::error title=Speed gate::${j.name}: ${j.reasons.join("; ")}\n`);
  }
  if (failing.length > 0) process.exitCode = 1;
}

/**
 * One base's table (and, with a compare, the gate's): printed, added to the job summary and
 * written to `out`. Returns the run's route summary and the gate's judgements.
 */
function report({ plan, who, base, label, results, chain }, { compare, out, gateLine = true }) {
  // Per route: did every sample answer with the route's own status, and the warm TTFB p50.
  const statusOk = (route, status) =>
    route.expect !== undefined ? route.expect.includes(status) : status >= 200 && status < 300;
  const summary = plan.map((route) => {
    if (route.skip !== undefined) return { name: route.name, skip: route.skip };
    const rows = results.filter((r) => r.route === route.name);
    const warm = rows.filter((r) => r.kind === "reused").map((r) => r.ttfb);
    return {
      name: route.name,
      path: route.path,
      statusOk: rows.every((r) => statusOk(route, r.status)),
      statuses: [...new Set(rows.map((r) => r.status))].join("/"),
      warmP50: median(warm),
    };
  });

  // The gate judges the candidate: this run, or the branch's run when this one is staging.
  const gated = compare.candidate ? compare.candidate.summary : summary;
  const baseline = compare.candidate ? summary : (compare.baseline?.summary ?? null);
  const judgements = judgeRun(gated, baseline);
  const own = compare.candidate ? judgeRun(summary, null) : judgements;
  const ownByName = new Map(own.map((j) => [j.name, j]));
  const gateCell = (j) =>
    j.verdict === "FAIL"
      ? `**FAIL**: ${j.reasons.join("; ")}`
      : j.reasons.length > 0
        ? `${j.verdict}: ${j.reasons.join("; ")}`
        : `${j.verdict}`;

  // ------------------------------------------------------------------------------------------
  const lines = [];
  lines.push(`### ${label}`);
  lines.push("");
  lines.push(`Base \`${base}\` · ${samples} samples per cell · as ${who}`);
  lines.push("");
  lines.push(
    "| Route | Conn | Status | TTFB p50 (spread) | Server p50 | Total p50 | Cold | Claims p50 | Colo | Gate |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const route of plan) {
    if (route.skip !== undefined) {
      lines.push(`| ${route.name} | · | skipped: ${route.skip} | · | · | · | · | · | · | SKIP |`);
      continue;
    }
    for (const kind of ["fresh", "reused"]) {
      const rows = results.filter((r) => r.route === route.name && r.kind === kind);
      if (rows.length === 0) continue;
      const statuses = [...new Set(rows.map((r) => r.status))].join("/");
      const colos = [...new Set(rows.map((r) => r.colo).filter(Boolean))].join(" ");
      const cold = rows.filter((r) => r.timing.n === 1).length;
      const seen = rows.filter((r) => r.timing.n !== undefined).length;
      const claims = rows.map((r) => r.timing.claims).filter((v) => typeof v === "number");
      // The verdict sits on the warm row, the one the gate reads.
      const judgement = ownByName.get(route.name);
      lines.push(
        `| ${route.name} | ${kind === "reused" ? "warm" : "fresh"} | ${statuses} | **${ms(
          median(rows.map((r) => r.ttfb)),
        )}** (${range(rows.map((r) => r.ttfb))}) | ${ms(
          median(rows.map((r) => r.ttfb - r.connect)),
        )} | ${ms(median(rows.map((r) => r.total)))} | ${seen ? `${cold}/${seen}` : "·"} | ${
          claims.length ? ms(median(claims)) : "·"
        } | ${colos} | ${kind === "reused" && judgement ? gateCell(judgement) : ""} |`,
      );
    }
  }
  if (compare.candidate) {
    lines.push("");
    lines.push(
      `Staging's own rows above are for reference; the gate judges **${compare.candidate.label}** against them:`,
    );
  }
  if (compare.candidate || compare.baseline) {
    lines.push("");
    lines.push("| Route | Warm p50 | Staging warm p50 | Δ | Gate |");
    lines.push("|---|---|---|---|---|");
    for (const j of judgements) {
      if (j.verdict === "SKIP") {
        lines.push(`| ${j.name} | skipped: ${j.skip} | · | · | SKIP |`);
        continue;
      }
      const delta = j.baselineP50 !== undefined ? (j.warmP50 ?? 0) - j.baselineP50 : undefined;
      lines.push(
        `| ${j.name} | ${ms(j.warmP50 ?? 0)} | ${
          j.baselineP50 !== undefined ? ms(j.baselineP50) : "·"
        } | ${delta !== undefined ? `${delta >= 0 ? "+" : ""}${ms(delta)}` : "·"} | ${gateCell(j)} |`,
      );
    }
  }
  if (gateLine) {
    lines.push("");
    lines.push(summaryLine(judgements, { compared: baseline !== null }));
  }
  if (chain && chain.length > 0) {
    lines.push("");
    lines.push(
      "**The layout's chain, timed on the Worker** (`/diagnostics/timing`, ms, p50 of each part):",
    );
    lines.push("");
    const keys = Object.keys(chain[0]).filter((k) => typeof chain[0][k] === "number");
    lines.push(`| ${keys.join(" | ")} |`);
    lines.push(`|${keys.map(() => "---").join("|")}|`);
    lines.push(`| ${keys.map((k) => ms(median(chain.map((r) => r[k])))).join(" | ")} |`);
    const info = Object.entries(chain[0]).filter(([, v]) => typeof v !== "number");
    if (info.length) lines.push("", info.map(([k, v]) => `${k}: \`${String(v)}\``).join(" · "));
  }
  lines.push("");
  const text = lines.join("\n");
  process.stdout.write(text + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  if (out) {
    writeFileSync(
      out,
      JSON.stringify({ label, base, samples, who, summary, results, chain }, null, 2),
    );
  }

  return { summary, judgements };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
