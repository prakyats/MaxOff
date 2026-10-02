import { writeFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { addISTDays, istInstant, todayIST } from "../src/core/time";
import { hydrated, memberIdOf, removeTasksTitled, rpcAs, storageStateFor, taskTypeId, USERS } from "./helpers";

test.use({ storageState: storageStateFor("owner") });

test("repro: quick view switches with slow view fetches never reload", async ({ page }, info) => {
  const prefix = `Repro ${info.project.name} `;
  await removeTasksTitled(prefix);
  const staffId = await memberIdOf(USERS.staff.email);
  const taskId = await rpcAs<string>(USERS.owner.email, USERS.owner.password, "task_create", {
    title: `${prefix}x`, description: null, task_type_id: await taskTypeId("Normal"), client_id: null,
    priority: "medium", due_at: istInstant(addISTDays(todayIST(), 45), "18:00"),
    assignee_ids: [staffId], primary_owner_id: staffId, approving_admin_id: null, stages: [],
  });
  const seen: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) seen.push(`NAV ${f.url()}`); });
  page.on("requestfinished", (r) => { if (r.url().includes("_rsc") && r.url().includes("/tasks/")) seen.push(`DONE ${r.url()}`); });
  page.on("requestfailed", (r) => { if (r.url().includes("_rsc") && r.url().includes("/tasks/")) seen.push(`FAIL ${r.failure()?.errorText} ${r.url()}`); });
  page.on("console", (m) => seen.push(`CONSOLE ${m.type()} ${m.text().slice(0, 300)}`));
  page.on("request", (r) => { if (r.isNavigationRequest()) seen.push(`DOC ${r.url()}`); });
  await page.route(/\/tasks\/[^/?]+/, async (route) => {
    const r = route.request();
    seen.push(`${r.url()} ${JSON.stringify(Object.keys(r.headers()).filter((h) => h.startsWith("next") || h === "rsc"))}`);
    if (r.headers()["rsc"]) await new Promise((res) => setTimeout(res, Number(process.env.R_DELAY ?? 0)));
    await route.continue();
  });
  await page.clock.install();
  await page.goto(`/tasks/${taskId}`);
  await hydrated(page);
  await expect(page.locator('[data-slot="task-tabs"]')).toHaveAttribute("data-live", "");
  const tab = (v: string) => page.locator(`[data-slot="task-tab"][data-view-tab="${v}"]`);
  await tab(process.env.R_FIRST ?? "activity").click();
  await page.waitForTimeout(300);
  seen.push("-- refresh");
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  if (process.env.R_SECOND) { await page.waitForTimeout(Number(process.env.R_GAP ?? 50)); await tab(process.env.R_SECOND).click(); }
  await page.waitForTimeout(4000);
  void writeFile(`/tmp/claude-0/repro-${info.project.name}.txt`, seen.join("\n"));
});
