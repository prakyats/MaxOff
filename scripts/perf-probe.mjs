#!/usr/bin/env node
// Times what the Worker answers, route by route, from wherever this runs (unit P, 2026-10-15:
// "the app has become slow after v1.7.0"). Run by `.github/workflows/perf.yml` from a GitHub
// runner against a branch preview and against staging, and by hand:
//
//   node scripts/perf-probe.mjs --base https://phase-x-maxoff-staging.<sub>.workers.dev
//                               [--samples 5] [--role owner] [--label "phase-x @ abc1234"]
//                               [--project <id>] [--client <id>] [--out probe.json] [--no-signin]
//
// Environment: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (the project the Worker talks to) and
// one way to sign in: PROBE_EMAIL + PROBE_PASSWORD (GoTrue's password grant, no secret), or
// SUPABASE_SECRET_KEY (the service key: the first active member of `--role` gets a session
// through a magic link that is never sent; PROBE_EMAIL picks the member). **Staging only**:
// never point it at production, and never put a production key in its environment.
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
// the Worker: claims, the member row, the Today / push / counts reads, each in ms.
//
// Where this runs matters: a GitHub runner sits in the US, so every Worker → Supabase (Mumbai)
// round trip costs ~200 ms there against a few tens from India. That exaggerates a waterfall
// (good: it shows) and says nothing about the owner's absolute numbers; the `colo` column says
// where the Worker ran, and the same script from India gives the real ones.
import { appendFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

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

const env = {
  url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey:
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  secretKey: process.env.SUPABASE_SECRET_KEY,
  email: process.env.PROBE_EMAIL,
  password: process.env.PROBE_PASSWORD,
};
if (/maxoff\.in|^https:\/\/maxoff\.pixoraclips/.test(base)) {
  throw new Error("Never probe production with a signed-in session.");
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

async function pickIds(session) {
  const headers = {
    apikey: env.publishableKey,
    authorization: `Bearer ${session.access_token}`,
  };
  const read = async (query) => {
    const response = await fetch(`${env.url}/rest/v1/${query}`, { headers });
    if (!response.ok) throw new Error(`${query}: ${response.status}`);
    return response.json();
  };
  const client =
    args.client ??
    (await read("clients?select=id&state=eq.active&order=created_at.asc&limit=1"))[0]?.id;
  const project =
    args.project ??
    (
      await read("projects?select=id,client_id&archived_at=is.null&order=created_at.desc&limit=1")
    )[0];
  return {
    client: client ?? null,
    project: project
      ? typeof project === "string"
        ? { id: project, client_id: client }
        : project
      : null,
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
    const req = https.request(url, { method: "GET", agent, headers }, (res) => {
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
      socket.once("connect", () => {
        connected = performance.now() - start;
      });
      socket.once("secureConnect", () => {
        secured = performance.now() - start;
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** `Server-Timing: claims;dur=12, isolate;desc="n=1 age=0"` → `{ claims: 12, n: 1, age: 0 }`. */
function parseServerTiming(value) {
  const out = {};
  for (const metric of String(value).split(",")) {
    const [name, ...params] = metric.trim().split(";");
    if (!name) continue;
    for (const param of params) {
      const [key, raw] = param.split("=");
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

async function json(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) return { status: response.status };
  return response.json();
}

const median = (values) =>
  values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const ms = (value) => `${Math.round(value)}`;
const range = (values) =>
  values.length === 0 ? "" : `${ms(Math.min(...values))}–${ms(Math.max(...values))}`;

// ---------------------------------------------------------------------------------------------
async function main() {
  let cookie = null;
  let ids = { client: null, project: null };
  let who = "signed out";
  if (signIn) {
    const { session, email } = await mintSession();
    cookie = await cookieHeaderFor(session);
    ids = await pickIds(session);
    const [, payload] = session.access_token.split(".");
    const header = JSON.parse(Buffer.from(session.access_token.split(".")[0], "base64url"));
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    who = `${email} (${claims.role ?? "?"}; JWT ${header.alg}${
      header.alg?.startsWith("HS") ? ": symmetric, getClaims() asks GoTrue every time" : ""
    })`;
  }

  const routes = [
    { name: "static (no Worker)", path: "/manifest.webmanifest", auth: false },
    { name: "404 (Worker, no data)", path: "/__perf-probe-nope", auth: false },
    { name: "/api/health", path: "/api/health", auth: false },
    { name: "/login", path: "/login", auth: false },
  ];
  if (cookie) {
    routes.push(
      { name: "/today", path: "/today", auth: true },
      { name: "/tasks", path: "/tasks", auth: true },
      { name: "/clients", path: "/clients", auth: true },
      ...(ids.client ? [{ name: "a client", path: `/clients/${ids.client}`, auth: true }] : []),
      ...(ids.project
        ? [
            {
              name: "a project",
              path: `/clients/${ids.project.client_id}/projects/${ids.project.id}`,
              auth: true,
            },
          ]
        : []),
      { name: "/settings/templates", path: "/settings/templates", auth: true },
      { name: "/diagnostics/timing", path: "/diagnostics/timing", auth: true },
    );
  }

  const headersFor = (route) => ({
    "user-agent": "maxoff-perf-probe",
    accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    ...(route.auth && cookie ? { cookie } : {}),
  });

  const results = [];
  // Fresh connections, routes interleaved so no route gets every warm isolate or every cold one.
  for (let i = 0; i < samples; i++) {
    for (const route of routes) {
      const agent = new https.Agent({ keepAlive: false });
      const r = await request(base + route.path, { agent, headers: headersFor(route) });
      agent.destroy();
      results.push({ ...r, route: route.name, kind: "fresh" });
    }
  }
  // One kept-alive connection for everything: a warm Worker, the way a phone taps around.
  const keep = new https.Agent({ keepAlive: true, maxSockets: 1 });
  await request(base + "/manifest.webmanifest", { agent: keep, headers: headersFor(routes[0]) });
  for (let i = 0; i < samples; i++) {
    for (const route of routes) {
      const r = await request(base + route.path, { agent: keep, headers: headersFor(route) });
      results.push({ ...r, route: route.name, kind: "reused" });
    }
  }
  keep.destroy();

  // The layout's chain as the Worker itself timed it.
  let chain = null;
  if (cookie) {
    const reads = [];
    for (let i = 0; i < samples; i++) {
      reads.push(await json(base + "/diagnostics/timing", headersFor({ auth: true })));
    }
    chain = reads.filter((r) => r && typeof r.total === "number");
  }

  // ------------------------------------------------------------------------------------------
  const lines = [];
  lines.push(`### ${label}`);
  lines.push("");
  lines.push(`Base \`${base}\` · ${samples} samples per cell · as ${who}`);
  lines.push("");
  lines.push(
    "| Route | Conn | Status | TTFB p50 (spread) | Server p50 | Total p50 | Cold | Claims p50 | Colo |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const route of routes) {
    for (const kind of ["fresh", "reused"]) {
      const rows = results.filter((r) => r.route === route.name && r.kind === kind);
      if (rows.length === 0) continue;
      const statuses = [...new Set(rows.map((r) => r.status))].join("/");
      const colos = [...new Set(rows.map((r) => r.colo).filter(Boolean))].join(" ");
      const cold = rows.filter((r) => r.timing.n === 1).length;
      const seen = rows.filter((r) => r.timing.n !== undefined).length;
      const claims = rows.map((r) => r.timing.claims).filter((v) => typeof v === "number");
      lines.push(
        `| ${route.name} | ${kind} | ${statuses} | **${ms(median(rows.map((r) => r.ttfb)))}** (${range(
          rows.map((r) => r.ttfb),
        )}) | ${ms(median(rows.map((r) => r.ttfb - r.connect)))} | ${ms(
          median(rows.map((r) => r.total)),
        )} | ${seen ? `${cold}/${seen}` : "·"} | ${claims.length ? ms(median(claims)) : "·"} | ${colos} |`,
      );
    }
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
  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ label, base, samples, who, results, chain }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
