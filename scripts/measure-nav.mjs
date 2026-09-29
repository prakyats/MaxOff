// Measures what each main screen costs on the server: the page request's time and the database
// round trips it makes, on a first load and on a client-side navigation (the tab-tap-feedback
// and performance work, 2026-09-28). Re-run it after any change to a screen's reads.
//
//   node scripts/measure-nav.mjs [--base http://localhost:3300] [--runs 3] [--as owner,staff]
//                                [--proxy 54399 --upstream http://127.0.0.1:54321]
//                                [--throttle 4g] [--screens /today,/leave] [--flow] [--installed]
//
// `--flow` measures what a person feels instead: on a warm app at 375 px, each bottom-bar tab
// tapped in turn (time until its skeleton, then its content, is on screen) and a tap back to a
// tab seen seconds ago.
//
// Round trips (local only): build and start the app with NEXT_PUBLIC_SUPABASE_URL pointing at the
// proxy port (`--proxy`), which passes every request through to Supabase and records when it
// started and ended. Only the server's requests are counted (the browser's own are left out by
// user agent), only those that start inside the page request itself, and link prefetches are
// refused while measuring, so each list is the screen's own. Reported per screen:
//   trips   database/auth requests the server made for that page request
//   depth   the longest chain of requests that had to wait for each other (1 = all parallel)
//   db      time from the first request to the last one ending
//   ttfb    first byte of the document (first load) or of the RSC payload (navigation)
//   done    the response fully streamed
//
// Against a preview or staging, sign in as a real person instead: `--email you@example.com`, with
// the password in MEASURE_PASSWORD (never on the command line); round trips are not available
// there, the timings are. `--throttle 4g` applies a 4G-class network (150 ms RTT, 1.6 Mbps down).
import http from "node:http";

import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, arg, i, all) =>
        arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs,
      [],
    ),
);
const base = args.base ?? "http://localhost:3300";
const runs = Number(args.runs ?? 3);

const SEED = {
  owner: { email: "owner@maxoff.local", password: "owner-local-password" },
  admin: { email: "admin@maxoff.local", password: "admin-local-password" },
  staff: { email: "staff@maxoff.local", password: "staff-local-password" },
};
const people = args.email
  ? [
      {
        label: args.email,
        role: args.role ?? "owner",
        email: args.email,
        password: process.env.MEASURE_PASSWORD ?? "",
      },
    ]
  : (args.as ?? "owner,staff").split(",").map((role) => ({ label: role, role, ...SEED[role] }));

/** The screens each role opens, in the order a person moves through them. `:client` and
 * `:person` are resolved from the first row of /clients and /people. */
const SCREENS = {
  owner: ["/today", "/approvals", "/tasks", "/clients", ":client", "/people", ":person", "/me"],
  admin: ["/today", "/leave", "/clients", ":client", "/people", ":person", "/me"],
  staff: ["/my-day", "/tasks", "/leave", "/notifications", "/me"],
};

const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const FOUR_G = {
  offline: false,
  latency: 150,
  downloadThroughput: 200_000,
  uploadThroughput: 94_000,
};
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : NaN;
};

// ---- The pass-through proxy that records the server's round trips ----------------------------
let log = [];
let inFlight = 0;
const t0 = performance.now();
const now = () => performance.now() - t0;
let proxy;
if (args.proxy) {
  const upstream = new URL(args.upstream ?? "http://127.0.0.1:54321");
  proxy = http.createServer((req, res) => {
    const entry = {
      method: req.method,
      path: req.url.split("?")[0],
      server: !/Mozilla/.test(req.headers["user-agent"] ?? ""),
      start: now(),
      end: NaN,
    };
    inFlight++;
    const out = http.request(
      {
        host: upstream.hostname,
        port: upstream.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: upstream.host },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
        up.on("end", () => {
          entry.end = now();
          inFlight--;
          log.push(entry);
        });
      },
    );
    out.on("error", () => {
      entry.end = now();
      inFlight--;
      res.destroy();
    });
    req.pipe(out);
  });
  await new Promise((resolve) => proxy.listen(Number(args.proxy), "127.0.0.1", resolve));
}

const quiet = async () => {
  // Wait until nothing has been in flight for 300 ms, so one screen's requests never spill over.
  let idleSince = now();
  while (now() - idleSince < 300) {
    if (inFlight > 0) idleSince = now();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** The longest chain of requests where each started only after the previous had ended. */
function depth(entries) {
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  const chain = sorted.map(() => 1);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = 0; j < i; j++) {
      if (sorted[j].end <= sorted[i].start) chain[i] = Math.max(chain[i], chain[j] + 1);
    }
  }
  return Math.max(0, ...chain);
}

function trips(from, to) {
  const server = log.filter((entry) => entry.server && entry.start >= from && entry.start <= to);
  if (server.length === 0) return { trips: 0, depth: 0, db: 0, list: [] };
  const first = Math.min(...server.map((entry) => entry.start));
  const last = Math.max(...server.map((entry) => entry.end));
  return {
    trips: server.length,
    depth: depth(server),
    db: Math.round(last - first),
    list: server
      .sort((a, b) => a.start - b.start)
      .map(
        (entry) =>
          `${Math.round(entry.start - first)
            .toString()
            .padStart(5)}–${Math.round(entry.end - first)
            .toString()
            .padEnd(5)} ${entry.method} ${entry.path}`,
      ),
  };
}

// ---- The tab flow: what a person feels on a warm app ----------------------------------------
/**
 * Taps each bottom-bar tab in turn on a warm app (prefetch allowed, as in real use), then taps
 * back to the first tab while it is still recent. Per tap: `skeleton` = the first frame with the
 * destination on screen (its skeleton or its content), `content` = the real content (no route
 * skeleton left). Then home again and the first other tab again, both seen seconds before.
 * Median of `runs` rounds.
 */
async function tabFlow(page, who) {
  const home = new URL(page.url()).pathname;
  await page.goto(home);
  await page.locator('[data-slot="bottom-nav"]').waitFor();
  const tabs = await page
    .locator('[data-slot="bottom-nav"] a[data-nav]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  const tap = async (href) => {
    // The Start-day prompt may open over the screen: close it the way a person would.
    if (await page.locator('[role="dialog"]').isVisible()) await page.keyboard.press("Escape");
    await page.waitForTimeout(1500); // idle: the viewport's prefetches have time to land
    const timing = page.evaluate(
      (to) =>
        new Promise((resolve) => {
          const start = performance.now();
          let skeleton = NaN;
          const check = () => {
            const here = location.pathname === to;
            const loading = document.querySelector('main [data-slot="loading-state"]');
            if (Number.isNaN(skeleton) && (loading || here)) skeleton = performance.now() - start;
            if (here && !loading && document.querySelector('[data-slot="page-header"]')) {
              resolve({ skeleton, content: performance.now() - start });
            } else requestAnimationFrame(check);
          };
          document.querySelector(`[data-slot="bottom-nav"] a[href="${to}"]`).click();
          requestAnimationFrame(check);
        }),
      href,
    );
    return timing;
  };
  const rows = new Map();
  const add = (label, sample) => {
    const list = rows.get(label) ?? [];
    list.push(sample);
    rows.set(label, list);
  };
  for (let run = 0; run < runs; run++) {
    await page.goto(home);
    await page.locator('[data-slot="bottom-nav"]').waitFor();
    const others = tabs.filter((href) => href !== home);
    for (const href of others) add(href, await tap(href));
    add(`${home} (back, recent)`, await tap(home));
    // Another tab seen seconds ago: the router cache, not history (installed: a replace).
    if (others[0]) add(`${others[0]} (again, recent)`, await tap(others[0]));
  }
  return [...rows].map(([path, samples]) => ({
    who,
    path,
    flow: {
      skeleton: median(samples.map((s) => s.skeleton)),
      content: median(samples.map((s) => s.content)),
    },
  }));
}

// ---- The browser side --------------------------------------------------------------------------
const browser = await chromium.launch();
const results = [];
try {
  for (const person of people) {
    const context = await browser.newContext({ ...PHONE, baseURL: base });
    // `--installed`: the app as the team uses it, added to the home screen. Chromium cannot
    // emulate `display-mode: standalone`, so the media query is answered the way the e2e helper
    // `runInstalled` does, and the bar's tabs take the installed path (`router.push`/`replace`).
    if ("installed" in args) {
      await context.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (query) =>
          query.includes("display-mode: standalone")
            ? {
                matches: true,
                media: query,
                onchange: null,
                addEventListener() {},
                removeEventListener() {},
                addListener() {},
                removeListener() {},
                dispatchEvent: () => false,
              }
            : real(query);
      });
    }
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password", { exact: true }).fill(person.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    // The prefetches a page starts after it renders would land in its list: refused while
    // measuring round trips, so the navigation fetches everything itself (the cold-tab case).
    if (args.proxy && !("flow" in args)) {
      await page.route("**/*", (route) =>
        route.request().headers()["next-router-prefetch"] ? route.abort() : route.fallback(),
      );
    }
    if (args.throttle === "4g") {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.emulateNetworkConditions", FOUR_G);
    }

    if ("flow" in args) {
      results.push(...(await tabFlow(page, person.label)));
      await context.close();
      continue;
    }

    const screens = (args.screens?.split(",") ?? SCREENS[person.role]).slice();
    for (const [index, screen] of screens.entries()) {
      if (screen.startsWith(":")) {
        const list = screen === ":client" ? "/clients" : "/people";
        await page.goto(list);
        const link = page.locator(`main a[href^="${list}/"]`).first();
        await link.waitFor({ timeout: 10_000 }).catch(() => undefined);
        const href = (await link.count()) > 0 ? await link.getAttribute("href") : null;
        screens[index] = href ?? "";
      }
    }

    for (const path of screens.filter(Boolean)) {
      const first = [];
      const nav = [];
      for (let run = 0; run < runs; run++) {
        // First load: a full document request.
        await quiet();
        log = [];
        const firstFrom = now();
        const response = await page.goto(path, { waitUntil: "load" });
        await response?.finished();
        const firstTo = now();
        await page.locator('[data-slot="page-header"]:visible').first().waitFor();
        await page
          .locator('main [data-slot="loading-state"]')
          .first()
          .waitFor({ state: "detached" });
        const firstContent = now() - firstFrom;
        await quiet();
        const timing = response ? response.request().timing() : undefined;
        first.push({
          ttfb: timing ? timing.responseStart : NaN,
          done: timing ? timing.responseEnd : NaN,
          content: firstContent,
          ...trips(firstFrom, firstTo),
        });

        // Client-side navigation: from another screen, the way a tab tap arrives.
        const from = path === screens[0] ? screens[1] : screens[0];
        await page.goto(from, { waitUntil: "load" });
        await page.locator('[data-slot="page-header"]:visible').first().waitFor();
        await quiet();
        log = [];
        const navFrom = now();
        // In the page: tap-to-content, the way a person sees it (the URL has moved and no route
        // skeleton is left), and the RSC request's own timing. Next cancels the navigation fetch
        // once it has read it, so the browser reports it aborted: Resource Timing still has it.
        const navTiming = await page.evaluate(async (to) => {
          performance.clearResourceTimings();
          const start = performance.now();
          // A query no screen reads makes it a new URL, so the router cache (or a prefetch)
          // never answers it and the server's work is measured: the cold-tab case.
          const token = Math.random().toString(36).slice(2);
          window.next.router.push(`${to}?measure=${token}`);
          await new Promise((resolve) => {
            const check = () => {
              const arrived =
                location.pathname === to &&
                !document.querySelector('main [data-slot="loading-state"]') &&
                document.querySelector('[data-slot="page-header"]');
              if (arrived) resolve(undefined);
              else requestAnimationFrame(check);
            };
            check();
          });
          const content = performance.now() - start;
          const entry = performance
            .getEntriesByType("resource")
            .find((e) => e.name.includes(`measure=${token}`) && e.name.includes("_rsc="));
          return {
            ttfb: entry ? entry.responseStart - start : NaN,
            done: entry ? entry.responseEnd - start : NaN,
            content,
          };
        }, path);
        await quiet();
        const navTo = navFrom + navTiming.done + 50;
        nav.push({
          ttfb: navTiming.ttfb,
          done: navTiming.done,
          content: navTiming.content,
          ...trips(navFrom, navTo),
        });
      }
      const summary = (samples) => ({
        ttfb: median(samples.map((s) => s.ttfb)),
        done: median(samples.map((s) => s.done)),
        trips: median(samples.map((s) => s.trips)),
        depth: median(samples.map((s) => s.depth)),
        db: median(samples.map((s) => s.db)),
        content: median(samples.map((s) => s.content)),
        list: samples.at(-1).list,
      });
      results.push({ who: person.label, path, first: summary(first), nav: summary(nav) });
    }
    await context.close();
  }
} finally {
  await browser.close();
  proxy?.close();
}

/** The tables go to stdout, so they can be redirected to a file. */
const print = (line) =>
  process.stdout.write(`${line}
`);
const cell = (value) => (Number.isFinite(value) ? String(value) : "–");
if ("flow" in args) {
  print("| who | tab tap | skeleton on screen ms | content ms |");
  print("|---|---|---|---|");
  for (const r of results) {
    print(`| ${r.who} | ${r.path} | ${cell(r.flow.skeleton)} | ${cell(r.flow.content)} |`);
  }
  process.exit(0);
}
print(
  "| who | screen | first load: ttfb / streamed / content ms | trips / depth / db ms | navigation: ttfb / streamed / content ms | trips / depth / db ms |",
);
print("|---|---|---|---|---|---|");
const trip = (r) => (args.proxy ? `${r.trips} / ${r.depth} / ${r.db}` : "–");
for (const r of results) {
  print(
    `| ${r.who} | ${r.path} | ${cell(r.first.ttfb)} / ${cell(r.first.done)} / ${cell(r.first.content)} | ${trip(r.first)} | ` +
      `${cell(r.nav.ttfb)} / ${cell(r.nav.done)} / ${cell(r.nav.content)} | ${trip(r.nav)} |`,
  );
}
if (args.proxy && "list" in args) {
  for (const r of results) {
    print(`\n${r.who} ${r.path} (first load, last run)\n${r.first.list.join("\n")}`);
    print(`\n${r.who} ${r.path} (navigation, last run)\n${r.nav.list.join("\n")}`);
  }
}
