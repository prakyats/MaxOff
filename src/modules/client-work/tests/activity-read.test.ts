import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertPermission, listDirectoryOf, pageProjectActivity, listItemsById, listStages } =
  vi.hoisted(() => ({
    assertPermission: vi.fn(),
    listDirectoryOf: vi.fn(),
    pageProjectActivity: vi.fn(),
    listItemsById: vi.fn(),
    listStages: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/permissions/server", () => ({ assertPermission }));
vi.mock("@/modules/team", () => ({ listDirectoryOf }));
vi.mock("../data/projects", () => ({ pageProjectActivity, listItemsById, listStages }));

import { ACTIVITY_PAGE, readProjectActivity } from "../actions/background";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000002";

function entry(id: number, patch: Record<string, unknown> = {}) {
  return {
    id,
    actorId: "ravi",
    onBehalfOfId: null,
    entity: "project_items",
    entityId: ITEM,
    action: "done",
    old: {},
    new: {},
    meta: {},
    at: `2026-10-09T05:${String(59 - (id % 60)).padStart(2, "0")}:00Z`,
    ...patch,
  };
}

/**
 * The Activity panel's page (`GET /api/client-work/activity`; the 7B rework's review, S7): the
 * permission first, the cursor handed to the read as it came, every entry the read returns made a
 * line (the SQL returns only what the history describes), and `next` set only on a full page.
 */
describe("readProjectActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertPermission.mockResolvedValue({ id: "ravi", role: "admin" });
    listDirectoryOf.mockResolvedValue([{ id: "ravi", fullName: "Ravi" }]);
    listItemsById.mockResolvedValue([{ id: ITEM, title: "Reel 1" }]);
    listStages.mockResolvedValue([]);
  });

  it("checks projects.manage before reading, and refuses without reading", async () => {
    assertPermission.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(readProjectActivity({ projectId: PROJECT })).rejects.toThrow("FORBIDDEN");
    expect(assertPermission).toHaveBeenCalledWith("projects.manage");
    expect(pageProjectActivity).not.toHaveBeenCalled();
  });

  it("hands the chip, the item and the cursor to the read, 20 a page", async () => {
    pageProjectActivity.mockResolvedValue([]);
    await readProjectActivity({
      projectId: PROJECT,
      kind: "items",
      itemId: ITEM,
      beforeAt: "2026-10-09T05:00:00Z",
      beforeId: "42",
    });
    expect(pageProjectActivity).toHaveBeenCalledWith({
      projectId: PROJECT,
      kind: "items",
      itemId: ITEM,
      before: { at: "2026-10-09T05:00:00Z", id: 42 },
      limit: ACTIVITY_PAGE,
    });
    expect(ACTIVITY_PAGE).toBe(20);
    await readProjectActivity({ projectId: PROJECT });
    expect(pageProjectActivity).toHaveBeenLastCalledWith({
      projectId: PROJECT,
      kind: "all",
      itemId: null,
      before: null,
      limit: ACTIVITY_PAGE,
    });
  });

  it("refuses half a cursor before any read", async () => {
    await expect(
      readProjectActivity({ projectId: PROJECT, beforeAt: "2026-10-09T05:00:00Z" }),
    ).rejects.toThrow();
    expect(assertPermission).not.toHaveBeenCalled();
    expect(pageProjectActivity).not.toHaveBeenCalled();
  });

  it("makes a full page of lines and points the next page at its last entry", async () => {
    const entries = Array.from({ length: ACTIVITY_PAGE }, (_, index) => entry(index + 1));
    pageProjectActivity.mockResolvedValue(entries);
    const page = await readProjectActivity({ projectId: PROJECT });
    expect(page.lines).toHaveLength(ACTIVITY_PAGE);
    expect(page.lines[0]).toMatchObject({ id: 1, actor: "Ravi", text: "marked Reel 1 done" });
    expect(page.next).toEqual({ at: entries.at(-1)!.at, id: ACTIVITY_PAGE });
    expect(listItemsById).toHaveBeenCalledWith([ITEM]);
    expect(listDirectoryOf).toHaveBeenCalledWith(["ravi"]);
    expect(listStages).not.toHaveBeenCalled();
  });

  it("ends at a short page, and reads the project's stages only for the old tick entries", async () => {
    pageProjectActivity.mockResolvedValue([
      entry(1, { entity: "project_item_stages", action: "ticked", meta: { stage_id: "s1" } }),
    ]);
    listStages.mockResolvedValue([{ id: "s1", name: "Edit" }]);
    const page = await readProjectActivity({ projectId: PROJECT });
    expect(page.next).toBeNull();
    expect(page.lines.map((line) => line.text)).toEqual(["ticked Edit on Reel 1"]);
    expect(listStages).toHaveBeenCalledWith(PROJECT);
  });
});
