// Time to interactive on a phone (task 2.8): how long after navigation start a screen hydrates,
// under 4× CPU throttling (Chrome DevTools' "mid-tier mobile"). Until hydration, enhanced
// controls are plain links, so this is the window in which a tap is not yet the app's tap.
//
//   node scripts/measure-hydration.mjs [--base http://localhost:3200] [--runs 9] [--cpu 4]
//                                      [--as owner,staff]
//
// Each seed person signs in once through the real form (passing the day gate), then opens their
// home (`/today` for the Owner and Admin, `/my-day` for Staff) in a fresh context: nothing in the
// HTTP cache, the session cookies already there. Reported as the median of the runs (ms from
// navigation start):
//   html       the document fully streamed (the server's part: the layout's reads, the page)
//   fcp        first contentful paint
//   hydrated   `html[data-chrome]`, set by the app shell's mount effect (`MobileChrome`): the
//              shell and its bottom bar are interactive
//   blocking   total main-thread time in long tasks (> 50 ms) up to hydration, minus 50 ms each
//   js         decompressed script bytes loaded up to hydration
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
const runs = Number(args.runs ?? 9);
const cpu = Number(args.cpu ?? 4);

const SEED = {
  owner: { email: "owner@maxoff.local", password: "owner-local-password", home: "/today" },
  admin: { email: "admin@maxoff.local", password: "admin-local-password", home: "/today" },
  staff: { email: "staff@maxoff.local", password: "staff-local-password", home: "/my-day" },
};
const people = (args.as ?? "owner,staff")
  .split(",")
  .map((role) => ({ label: role, ...SEED[role] }));

const PHONE = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)]);
};

// Installed before any page script: notes when the hydration mark appears and every long task.
function probe() {
  const marks = { hydrated: NaN, longTasks: [] };
  window.__hydrationProbe = marks;
  // The init script runs before `<html>` is parsed, so the observer watches the document.
  const done = () => document.documentElement?.hasAttribute("data-chrome");
  new MutationObserver((_, observer) => {
    if (done()) {
      marks.hydrated = performance.now();
      observer.disconnect();
    }
  }).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-chrome"],
  });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) marks.longTasks.push([entry.startTime, entry.duration]);
  }).observe({ type: "longtask", buffered: true });
}

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
    await signIn.close();

    const samples = [];
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ ...PHONE, baseURL: base, storageState: state });
      const tab = await context.newPage();
      await tab.addInitScript(probe);
      const cdp = await context.newCDPSession(tab);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await tab.goto(person.home, { waitUntil: "commit" });
      await tab.waitForFunction(() => !Number.isNaN(window.__hydrationProbe?.hydrated), null, {
        timeout: 30_000,
      });
      samples.push(
        await tab.evaluate(async () => {
          const { hydrated, longTasks } = window.__hydrationProbe;
          const fcp = await new Promise((resolve) => {
            new PerformanceObserver((list) => {
              const entry = list.getEntriesByName("first-contentful-paint")[0];
              if (entry) resolve(entry.startTime);
            }).observe({ type: "paint", buffered: true });
            setTimeout(() => resolve(NaN), 2000);
          });
          const blocking = longTasks
            .filter(([start]) => start < hydrated)
            .reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0);
          const js = performance
            .getEntriesByType("resource")
            .filter((entry) => entry.initiatorType === "script" && entry.responseEnd <= hydrated)
            .reduce((sum, entry) => sum + entry.decodedBodySize, 0);
          const [nav] = performance.getEntriesByType("navigation");
          return { landed: location.pathname, html: nav.responseEnd, fcp, hydrated, blocking, js };
        }),
      );
      await context.close();
    }

    const pick = (key) => median(samples.map((sample) => sample[key]));
    console.warn(
      `${person.label.padEnd(6)} ${samples[0].landed.padEnd(8)} cpu ${cpu}×  html ${pick("html")}  ` +
        `fcp ${pick("fcp")}  ` +
        `hydrated ${pick("hydrated")}  blocking ${pick("blocking")}  ` +
        `js ${(pick("js") / 1024).toFixed(0)} KB  [median of ${runs}; hydrated min ` +
        `${Math.round(Math.min(...samples.map((s) => s.hydrated)))}, max ` +
        `${Math.round(Math.max(...samples.map((s) => s.hydrated)))}]`,
    );
  }
} finally {
  await browser.close();
}
