import type { Request } from "@playwright/test";

import { expect, test } from "./fixtures";

import {
  actionId,
  hydrated,
  removeRequestsTitled,
  serviceSelect,
  storageStateFor,
} from "./helpers";

/**
 * Weak network (v7.0 unit 2, "Reliable anywhere"; owner Q1 and Q3, 14 Nov 2026). A create made
 * often is repeat-safe: its form sends one request key per opening, so when the reply is lost after
 * MaxOff saved it (the phone's signal dropped on the way back), **Retry** is answered with what was
 * saved, never a second one. The reply is lost here exactly that way: the request reaches the
 * server, which answers, and the answer is thrown away before the page sees it.
 */
const REQUESTS = "src/modules/tasks/actions/requests.ts";

const callTo = (filename: string, exportedName: string) => {
  const id = actionId(filename, exportedName);
  return (request: Request) =>
    request.method() === "POST" && request.headers()["next-action"] === id;
};

test.describe("a create whose reply is lost", () => {
  test.use({ storageState: storageStateFor("staff") });

  test("Retry sends the suggestion once: one suggestion, not two", async ({ page }, info) => {
    test.skip(!["desktop", "mobile"].includes(info.project.name), "1280 and 375");
    const title = `Weak network ${info.project.name}: reel for the launch`;
    await removeRequestsTitled(title);
    try {
      const create = callTo(REQUESTS, "createRequest");
      let attempts = 0;
      await page.route("**/*", async (route) => {
        if (!create(route.request())) return route.fallback();
        attempts++;
        if (attempts > 1) return route.fallback();
        // Saved on the server, then the answer never reaches the phone.
        await route.fetch();
        return route.abort("internetdisconnected");
      });
      await page.goto("/tasks");
      await hydrated(page);
      await page.locator('[data-slot="suggest-task"]:visible').click();
      const dialog = page.getByRole("dialog", { name: "Suggest a task" });
      await dialog.getByLabel("What needs doing").fill(title);
      await dialog.getByRole("button", { name: "Send suggestion" }).click();

      const failed = dialog.locator('[data-slot="action-failed"]');
      await expect(failed).toContainText(
        "Couldn't reach MaxOff. Check your connection and try again.",
      );
      // What was typed is kept, and Retry is offered: the key makes it safe.
      await expect(dialog.getByLabel("What needs doing")).toHaveValue(title);
      await failed.getByRole("button", { name: "Retry" }).click();
      await expect(page.getByText("Suggestion sent")).toBeVisible();
      await expect(dialog).toBeHidden();
      expect(attempts, "the create was sent twice").toBe(2);

      const saved = await serviceSelect<{ id: string }>(
        `task_requests?title=eq.${encodeURIComponent(title)}&select=id`,
      );
      expect(saved, "one suggestion, not two").toHaveLength(1);
    } finally {
      await removeRequestsTitled(title);
    }
  });
});
