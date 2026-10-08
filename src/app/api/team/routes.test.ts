import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readClientHandover: vi.fn(),
  readCoordinatorChoices: vi.fn(),
  readFreelancerHandover: vi.fn(),
  readOpenTaskCount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember: reads.getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The module's own checks (zod, team.manage) are `modules/team/tests/background.test.ts`'s.
vi.mock("@/modules/team", () => ({
  readClientHandover: reads.readClientHandover,
  readCoordinatorChoices: reads.readCoordinatorChoices,
  readFreelancerHandover: reads.readFreelancerHandover,
  readOpenTaskCount: reads.readOpenTaskCount,
}));

import { AppError } from "@/core/errors";

import { GET as clientHandover } from "./client-handover/route";
import { GET as coordinatorChoices } from "./coordinator-choices/route";
import { GET as freelancerHandover } from "./freelancer-handover/route";
import { GET as openTaskCount } from "./open-task-count/route";

const ORIGIN = "https://app.example";

const ROUTES = [
  { path: "client-handover", get: clientHandover, read: reads.readClientHandover },
  { path: "coordinator-choices", get: coordinatorChoices, read: reads.readCoordinatorChoices },
  { path: "freelancer-handover", get: freelancerHandover, read: reads.readFreelancerHandover },
  { path: "open-task-count", get: openTaskCount, read: reads.readOpenTaskCount },
];

/** The Owner's dialogs' background reads (ARCHITECTURE §4.4). */
describe("the team background routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.getCurrentMember.mockResolvedValue({ id: "owner" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  for (const { path, get, read } of ROUTES) {
    it(`GET /api/team/${path}?member= hands the member to its read`, async () => {
      read.mockResolvedValue({ answer: path });
      const response = await get(new Request(`${ORIGIN}/api/team/${path}?member=m2`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: { answer: path } });
      expect(read).toHaveBeenCalledWith({ memberId: "m2" });
    });

    it(`GET /api/team/${path} refuses a signed-out caller; the read's refusals keep their code`, async () => {
      reads.getCurrentMember.mockResolvedValueOnce(null);
      expect((await get(new Request(`${ORIGIN}/api/team/${path}?member=m2`))).status).toBe(401);
      expect(read).not.toHaveBeenCalled();
      read.mockRejectedValueOnce(new AppError("FORBIDDEN"));
      expect((await get(new Request(`${ORIGIN}/api/team/${path}?member=m2`))).status).toBe(403);
      read.mockRejectedValueOnce(new AppError("VALIDATION"));
      expect((await get(new Request(`${ORIGIN}/api/team/${path}`))).status).toBe(400);
      expect(read).toHaveBeenLastCalledWith({ memberId: null });
    });
  }
});
