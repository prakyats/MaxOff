import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertPermission, listMembers, listCurrentCoordinators, listClientsRunBy, countOpen } =
  vi.hoisted(() => ({
    assertPermission: vi.fn(),
    listMembers: vi.fn(),
    listCurrentCoordinators: vi.fn(),
    listClientsRunBy: vi.fn(),
    countOpen: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/permissions/server", () => ({ assertPermission }));
vi.mock("@/modules/clients", () => ({ listClientsRunBy }));
vi.mock("@/modules/tasks", () => ({ countOpenAssignments: countOpen }));
vi.mock("../data/members", () => ({ listMembers, listCurrentCoordinators }));

import {
  readClientHandover,
  readCoordinatorChoices,
  readFreelancerHandover,
  readOpenTaskCount,
} from "../actions/background";

const ID = {
  admin: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002",
  staff: "00000000-0000-4000-8000-000000000003",
  free: "00000000-0000-4000-8000-000000000004",
};

function member(id: string, fullName: string, role: string, engagement = "permanent") {
  return { id, fullName, role, status: "active", engagement };
}

/**
 * The Owner's dialogs' reads (ARCHITECTURE §4.4: background calls behind `/api/team/*`), with the
 * checks of the server actions they replaced: zod, then `team.manage`, then the reads.
 */
describe("team background reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMembers.mockResolvedValue([
      member(ID.admin, "Ravi", "admin"),
      member(ID.other, "Asha", "admin"),
      member(ID.staff, "Meera", "staff"),
      member(ID.free, "Kiran", "staff", "freelancer"),
    ]);
    listCurrentCoordinators.mockResolvedValue({ [ID.free]: ID.staff });
    listClientsRunBy.mockResolvedValue([{ id: "c1", name: "Studio" }]);
    countOpen.mockResolvedValue(3);
  });

  it("the client handover: the Admin's clients and every other active Admin", async () => {
    expect(await readClientHandover({ memberId: ID.admin })).toEqual({
      clients: [{ id: "c1", name: "Studio" }],
      admins: [{ id: ID.other, name: "Asha" }],
    });
    expect(assertPermission).toHaveBeenCalledWith("team.manage");
    expect(listClientsRunBy).toHaveBeenCalledWith(ID.admin);
  });

  it("the coordinator choices: the current one and everyone else who may coordinate", async () => {
    expect(await readCoordinatorChoices({ memberId: ID.free })).toEqual({
      current: { id: ID.staff, name: "Meera" },
      options: [
        { id: ID.other, name: "Asha" },
        { id: ID.admin, name: "Ravi" },
      ],
    });
    expect(assertPermission).toHaveBeenCalledWith("team.manage");
  });

  it("the freelancer handover: who the person coordinates and who may take them", async () => {
    expect(await readFreelancerHandover({ memberId: ID.staff })).toEqual({
      freelancers: [{ id: ID.free, name: "Kiran" }],
      coordinators: [
        { id: ID.other, name: "Asha" },
        { id: ID.admin, name: "Ravi" },
      ],
    });
  });

  it("the open task count", async () => {
    expect(await readOpenTaskCount({ memberId: ID.free })).toEqual({ openTasks: 3 });
    expect(countOpen).toHaveBeenCalledWith(ID.free);
  });

  it("every read refuses a member that is not an id before the permission or any read", async () => {
    for (const read of [
      readClientHandover,
      readCoordinatorChoices,
      readFreelancerHandover,
      readOpenTaskCount,
    ]) {
      await expect(read({ memberId: "x" })).rejects.toMatchObject({ name: "ZodError" });
      await expect(read({ memberId: null })).rejects.toMatchObject({ name: "ZodError" });
    }
    expect(assertPermission).not.toHaveBeenCalled();
    expect(listMembers).not.toHaveBeenCalled();
    expect(countOpen).not.toHaveBeenCalled();
  });

  it("a refused permission stops every read", async () => {
    assertPermission.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(readClientHandover({ memberId: ID.admin })).rejects.toThrow();
    await expect(readOpenTaskCount({ memberId: ID.free })).rejects.toThrow();
    expect(listClientsRunBy).not.toHaveBeenCalled();
    expect(countOpen).not.toHaveBeenCalled();
  });
});
