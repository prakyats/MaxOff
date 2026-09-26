// Measures a launch the way an installed app starts it (task 2.7): a signed-in person opens
// `start_url` (`/`) in a fresh browser context (nothing in the HTTP cache, the session cookies
// already there) at phone size, and we time every step to the first screen with content.
//
//   node scripts/measure-launch.mjs [--base http://localhost:3200] [--runs 5] [--as owner,staff]
//                                   [--no-hint]
//
// `--as` takes the local seed roles (owner, admin, staff). Against staging, sign in as a real
// person instead: `--email you@example.com` with the password in MEASURE_PASSWORD (never on the
// command line). Each person signs in once through the real form, which also passes the day gate.
//
// Reported per person, as the median of the runs (ms from navigation start):
//   redirects  time spent in same-origin redirects before the final document (`/` → home)
//   ttfb       first byte of the final document
//   fcp        first contentful paint
//   header     the visible page title bar, i.e. the screen is really there
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
const base = args.base ?? "http://localhost:3200";
const runs = Number(args.runs ?? 5);

const SEED = {
  owner: { email: "owner@maxoff.local", password: "owner-local-password" },
  admin: { email: "admin@maxoff.local", password: "admin-local-password" },
  staff: { email: "staff@maxoff.local", password: "staff-local-password" },
};
const people = args.email
  ? [{ label: args.email, email: args.email, password: process.env.MEASURE_PASSWORD ?? "" }]
  : (args.as ?? "owner,staff").split(",").map((role) => ({ label: role, ...SEED[role] }));

const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

const browser = await chromium.launch();
try {
  for (const person of people) {
    const signIn = await browser.newContext({ ...PHONE, baseURL: base });
    const page = await signIn.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(person.email);
    await page.getByLabel("Password", { exact: true }).fill(person.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    const choice = page.locator('[data-slot="choice-option"]').first();
    const header = page.locator('[data-slot="page-header"]:visible');
    await choice.or(header).first().waitFor();
    if (await choice.isVisible()) {
      await page.getByRole("radio", { name: /^Present\b/ }).check();
      await page.getByRole("button", { name: "Submit" }).click();
      await header.first().waitFor();
    }
    const state = await signIn.storageState();
    // `--no-hint` drops the home hint, so `/` takes the pre-2.7 path (a full render of
    // src/app/page.tsx that reads the member) — the "before" number on the same build.
    if ("no-hint" in args) state.cookies = state.cookies.filter((c) => c.name !== "maxoff_home");
    await signIn.close();

    const samples = [];
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ ...PHONE, baseURL: base, storageState: state });
      const launch = await context.newPage();
      await launch.goto("/", { waitUntil: "commit" });
      await launch.locator('[data-slot="page-header"]:visible').first().waitFor();
      samples.push(
        await launch.evaluate(async () => {
          const header = performance.now();
          const [nav] = performance.getEntriesByType("navigation");
          // The paint entry can land a frame after the header is in the DOM: wait for it.
          const fcp = await new Promise((resolve) => {
            new PerformanceObserver((list) => {
              const entry = list.getEntriesByName("first-contentful-paint")[0];
              if (entry) resolve(entry);
            }).observe({ type: "paint", buffered: true });
            setTimeout(() => resolve(undefined), 2000);
          });
          return {
            landed: location.pathname,
            redirectCount: nav.redirectCount,
            redirects: nav.redirectEnd - nav.redirectStart,
            ttfb: nav.responseStart,
            fcp: fcp ? fcp.startTime : NaN,
            header,
          };
        }),
      );
      await context.close();
    }

    const pick = (key) => median(samples.map((sample) => sample[key]));
    console.warn(
      `${person.label.padEnd(6)} → ${samples[0].landed}  redirects ${samples[0].redirectCount} ` +
        `(${pick("redirects")} ms)  ttfb ${pick("ttfb")}  fcp ${pick("fcp")}  header ${pick("header")}  ` +
        `[median of ${runs}]`,
    );
  }
} finally {
  await browser.close();
}
