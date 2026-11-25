import { describe, expect, it, vi } from "vitest";

import type { SubfolderStore } from "./upload-session";

vi.mock("server-only", () => ({}));
vi.mock("@/core/db/service", () => ({ createServiceSupabase: () => null }));

const { ensureSubfolders } = await import("./upload-session");

function memoryStore(start: Record<string, string> = {}): SubfolderStore & {
  rows: Record<string, string>;
} {
  const rows = { ...start };
  return {
    rows,
    find: async (path) => rows[path] ?? null,
    put: async (path, id) => {
      rows[path] ??= id;
      return rows[path];
    },
  };
}

describe("ensureSubfolders (a hand-in version's folders)", () => {
  it("makes v‹n› then each folder of the path, once", async () => {
    const store = memoryStore();
    const made: { name: string; parentId: string }[] = [];
    const make = async (folder: { name: string; parentId: string }) => {
      made.push(folder);
      return { id: `d${made.length}` };
    };
    const input = { parentDriveId: "task", top: "v2", relativePath: "Day 1/Cam A", store, make };
    await expect(ensureSubfolders(input)).resolves.toBe("d3");
    expect(made).toEqual([
      { name: "v2", parentId: "task" },
      { name: "Day 1", parentId: "d1" },
      { name: "Cam A", parentId: "d2" },
    ]);
    expect(store.rows).toEqual({ "": "d1", "Day 1": "d2", "Day 1/Cam A": "d3" });
    await ensureSubfolders(input);
    expect(made).toHaveLength(3);
  });

  it("uses the version folder alone for a phone's files, and keeps the folder that won a race", async () => {
    const make = async () => ({ id: "never" });
    const cached = memoryStore({ "": "existing" });
    await expect(
      ensureSubfolders({ parentDriveId: "task", top: "v1", relativePath: "", store: cached, make }),
    ).resolves.toBe("existing");
    const raced: SubfolderStore = { find: async () => null, put: async () => "winner" };
    await expect(
      ensureSubfolders({ parentDriveId: "task", top: "v1", relativePath: "", store: raced, make }),
    ).resolves.toBe("winner");
  });
});
