import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentMember, markTaskRead, readAvailability } = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  markTaskRead: vi.fn(),
  readAvailability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The module's own checks (zod, permission) are `modules/tasks/tests/background.test.ts`'s.
vi.mock("@/modules/tasks", () => ({ markTaskRead, readAvailability }));

import { AppError } from "@/core/errors";

import { GET as availabilityGET } from "./availability/route";
import { POST as readPOST } from "./read/route";

const ORIGIN = "https://app.example";

function post(body: unknown, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  return new Request(`${ORIGIN}/api/tasks/read`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** The tasks module's background routes (ARCHITECTURE §4.4). */
describe("the tasks background routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentMember.mockResolvedValue({ id: "m1" });
    readAvailability.mockResolvedValue([{ memberId: "a" }]);
    markTaskRead.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("GET /api/tasks/availability hands every member and day of the query to the read", async () => {
    const response = await availabilityGET(
      new Request(`${ORIGIN}/api/tasks/availability?member=a&member=b&day=2026-10-06`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: [{ memberId: "a" }] });
    expect(readAvailability).toHaveBeenCalledWith({ memberIds: ["a", "b"], days: ["2026-10-06"] });
  });

  it("GET /api/tasks/availability refuses a signed-out caller; the read's refusals keep their code", async () => {
    getCurrentMember.mockResolvedValueOnce(null);
    expect((await availabilityGET(new Request(`${ORIGIN}/api/tasks/availability`))).status).toBe(
      401,
    );
    expect(readAvailability).not.toHaveBeenCalled();
    readAvailability.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await availabilityGET(new Request(`${ORIGIN}/api/tasks/availability`))).status).toBe(
      403,
    );
    readAvailability.mockRejectedValueOnce(new AppError("VALIDATION"));
    expect((await availabilityGET(new Request(`${ORIGIN}/api/tasks/availability`))).status).toBe(
      400,
    );
  });

  it("POST /api/tasks/read hands the body to the read of Chat", async () => {
    const body = { taskId: "t1", upTo: "2026-10-06T10:00:00.000Z" };
    const response = await readPOST(post(body));
    expect(await response.json()).toEqual({ ok: true, data: null });
    expect(markTaskRead).toHaveBeenCalledWith(body);
  });

  it("POST /api/tasks/read refuses another origin and a signed-out caller before the write", async () => {
    expect((await readPOST(post({}, "https://evil.example"))).status).toBe(403);
    expect((await readPOST(post({}, null))).status).toBe(403);
    getCurrentMember.mockResolvedValueOnce(null);
    expect((await readPOST(post({}))).status).toBe(401);
    expect(markTaskRead).not.toHaveBeenCalled();
  });
});
