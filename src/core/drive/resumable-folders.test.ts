import { describe, expect, it } from "vitest";

import {
  cleanRelativePath,
  ensureSubfolders,
  fileFacts,
  finishedFileProblem,
  type SubfolderStore,
} from "./resumable";

describe("the folder path a browser reports", () => {
  it("is cleaned part by part, never climbs, at most 8 levels", () => {
    expect(cleanRelativePath("Day 1/CAM A")).toBe("Day 1/CAM A");
    expect(cleanRelativePath("../../etc//./x\\y")).toBe("etc/x/y");
    expect(cleanRelativePath("  ")).toBe("");
    expect(cleanRelativePath("a/b/c/d/e/f/g/h/i/j").split("/")).toHaveLength(8);
  });
});

describe("making the subfolders", () => {
  function memory() {
    const rows = new Map<string, string>();
    const store: SubfolderStore = {
      async find(path) {
        return rows.get(path) ?? null;
      },
      async put(path, id) {
        if (!rows.has(path)) rows.set(path, id);
        return rows.get(path)!;
      },
    };
    return { store, rows };
  }

  it("makes top, then each part, once; a second file reuses them", async () => {
    const { store } = memory();
    const made: Array<{ name: string; parentId: string }> = [];
    const make = async (folder: { name: string; parentId: string }) => {
      made.push(folder);
      return { id: `f${made.length}` };
    };
    const deepest = await ensureSubfolders({
      parentDriveId: "task",
      top: "Sam",
      relativePath: "Day 1/CAM A",
      store,
      make,
    });
    expect(made).toEqual([
      { name: "Sam", parentId: "task" },
      { name: "Day 1", parentId: "f1" },
      { name: "CAM A", parentId: "f2" },
    ]);
    expect(deepest).toBe("f3");
    expect(
      await ensureSubfolders({
        parentDriveId: "task",
        top: "Sam",
        relativePath: "Day 1",
        store,
        make,
      }),
    ).toBe("f2");
    expect(made).toHaveLength(3);
    expect(
      await ensureSubfolders({ parentDriveId: "task", top: "Sam", relativePath: "", store, make }),
    ).toBe("f1");
  });
});

describe("the finished-file check", () => {
  const facts = { id: "d1", sizeBytes: 10, md5: "abc", parents: ["p1"], trashed: false };
  it("passes a file of the right size in the right folder, with a matching checksum", () => {
    expect(finishedFileProblem(facts, { sizeBytes: 10, parentId: "p1", md5: "ABC" })).toBeNull();
    expect(finishedFileProblem(facts, { sizeBytes: 10, parentId: "p1" })).toBeNull();
  });
  it("names each problem", () => {
    expect(finishedFileProblem(null, { sizeBytes: 10, parentId: "p1" })).toBe("missing");
    expect(
      finishedFileProblem({ ...facts, trashed: true }, { sizeBytes: 10, parentId: "p1" }),
    ).toBe("missing");
    expect(finishedFileProblem(facts, { sizeBytes: 11, parentId: "p1" })).toBe("size_mismatch");
    expect(finishedFileProblem(facts, { sizeBytes: 10, parentId: "p2" })).toBe("wrong_folder");
    expect(finishedFileProblem(facts, { sizeBytes: 10, parentId: "p1", md5: "def" })).toBe(
      "checksum_mismatch",
    );
  });
});

describe("Google's record of a file", () => {
  const answer = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("reads size, checksum, parents and the bin; 404 is null; an outage throws", async () => {
    expect(
      await fileFacts(
        answer(200, { id: "d1", size: "10", md5Checksum: "ABC", parents: ["p1"], trashed: false }),
        "t",
        "d1",
      ),
    ).toEqual({ id: "d1", sizeBytes: 10, md5: "abc", parents: ["p1"], trashed: false });
    expect(await fileFacts(answer(404, {}), "t", "d1")).toBeNull();
    await expect(fileFacts(answer(503, {}), "t", "d1")).rejects.toThrow();
    await expect(fileFacts(answer(401, {}), "t", "d1")).rejects.toThrow("access token");
  });
});
