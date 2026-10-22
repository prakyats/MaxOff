import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  assertPermission: vi.fn(),
  getClient: vi.fn(),
  listContacts: vi.fn(),
  listClientActivity: vi.fn(),
  describeClientActivity: vi.fn(),
  listClientProjects: vi.fn(),
  listProjectsActivity: vi.fn(),
  describeProjectActivity: vi.fn(),
  listDirectory: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/permissions/server", () => ({ assertPermission: m.assertPermission }));
vi.mock("@/modules/clients", () => ({
  getClient: m.getClient,
  listContacts: m.listContacts,
  listClientActivity: m.listClientActivity,
  describeClientActivity: m.describeClientActivity,
}));
vi.mock("@/modules/client-work", () => ({
  listClientProjects: m.listClientProjects,
  listProjectsActivity: m.listProjectsActivity,
  describeProjectActivity: m.describeProjectActivity,
}));
vi.mock("@/modules/team", () => ({ listDirectory: m.listDirectory }));

import { AppError } from "@/core/errors";

import { readClientHistory } from "./read";

const CLIENT = "11111111-1111-4111-8111-111111111111";

describe("readClientHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.assertPermission.mockResolvedValue({ id: "owner", role: "owner" });
    m.getClient.mockResolvedValue({ id: CLIENT });
    m.listDirectory.mockResolvedValue([{ id: "owner", fullName: "Owner One" }]);
    m.listContacts.mockResolvedValue([{ id: "k1", name: "Kim" }]);
    m.listClientProjects.mockResolvedValue([{ id: "p1", name: "Retainer" }]);
    m.listClientActivity.mockResolvedValue([{ id: 1 }]);
    m.listProjectsActivity.mockResolvedValue([{ id: 2 }]);
    m.describeClientActivity.mockReturnValue({ id: 1, at: "2026-10-01", actor: "A", text: "x" });
    m.describeProjectActivity.mockReturnValue({ id: 2, at: "2026-10-02", actor: "B", text: "y" });
  });

  it("refuses a bad id before any read", async () => {
    await expect(readClientHistory({ clientId: "nope" })).rejects.toEqual(
      new AppError("VALIDATION"),
    );
    expect(m.getClient).not.toHaveBeenCalled();
  });

  it("checks the client permissions, then merges the lines newest first", async () => {
    const data = await readClientHistory({ clientId: CLIENT });
    expect(m.assertPermission).toHaveBeenCalledWith(["clients.manage", "clients.edit_assigned"]);
    expect(data.lines.map((line) => line.id)).toEqual([2, 1]);
    expect(data.limitedTo).toBeNull();
    expect(m.listClientActivity).toHaveBeenCalledWith(CLIENT, ["k1"]);
    expect(m.listProjectsActivity).toHaveBeenCalledWith(["p1"]);
    expect(m.describeClientActivity.mock.calls[0]?.[1]).toMatchObject({ showCloseReason: true });
  });

  it("an Admin never sees the close reason; a client RLS hides is not found", async () => {
    m.assertPermission.mockResolvedValue({ id: "admin", role: "admin" });
    await readClientHistory({ clientId: CLIENT });
    expect(m.describeClientActivity.mock.calls[0]?.[1]).toMatchObject({ showCloseReason: false });
    m.getClient.mockResolvedValue(null);
    await expect(readClientHistory({ clientId: CLIENT })).rejects.toEqual(
      new AppError("NOT_FOUND"),
    );
  });

  it("a refused permission reads nothing", async () => {
    m.assertPermission.mockRejectedValue(new AppError("FORBIDDEN"));
    await expect(readClientHistory({ clientId: CLIENT })).rejects.toEqual(
      new AppError("FORBIDDEN"),
    );
    expect(m.getClient).not.toHaveBeenCalled();
  });
});
