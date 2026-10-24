import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentMember, markTaskRead, readAvailability, readEarlierComments, listDirectoryOf } =
  vi.hoisted(() => ({
    getCurrentMember: vi.fn(),
    markTaskRead: vi.fn(),
    readAvailability: vi.fn(),
    readEarlierComments: vi.fn(),
    listDirectoryOf: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
// The module's own checks (zod, permission) are `modules/tasks/tests/background.test.ts`'s.
vi.mock("@/modules/tasks", async (original) => ({
  // The real wording (`chatMessages`); only the reads are stood in for.
  ...(await original<Record<string, unknown>>()),
  markTaskRead,
  readAvailability,
  readEarlierComments,
}));
vi.mock("@/modules/team", () => ({ listDirectoryOf }));

import { AppError } from "@/core/errors";

import { GET as availabilityGET } from "./availability/route";
import { GET as commentsGET } from "./comments/route";
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

  it("GET /api/tasks/comments hands the keyset to the read and words the page for the reader", async () => {
    const asha = "00000000-0000-4000-8000-000000000002";
    readEarlierComments.mockResolvedValueOnce({
      comments: [
        {
          id: "c1",
          authorId: asha,
          onBehalfOf: null,
          body: "Earlier",
          createdAt: "2026-10-20T06:00:00.000Z",
        },
        {
          id: "c2",
          authorId: "m1",
          onBehalfOf: null,
          body: "Mine",
          createdAt: "2026-10-20T06:01:00.000Z",
        },
      ],
      more: true,
    });
    listDirectoryOf.mockResolvedValueOnce([
      { id: asha, fullName: "Asha Rao", avatarFileId: null },
      { id: "m1", fullName: "Prishit Shah", avatarFileId: "f1" },
    ]);
    const response = await commentsGET(
      new Request(`${ORIGIN}/api/tasks/comments?task=t1&before=2026-10-21T00:00:00.000Z&id=c9`),
    );
    expect(response.status).toBe(200);
    expect(readEarlierComments).toHaveBeenCalledWith({
      taskId: "t1",
      before: "2026-10-21T00:00:00.000Z",
      beforeId: "c9",
    });
    const body = (await response.json()) as {
      ok: true;
      data: {
        more: boolean;
        messages: { author: string; own: boolean; time: string; body: string }[];
      };
    };
    expect(body.data.more).toBe(true);
    expect(
      body.data.messages.map(({ author, own, time, body: text }) => [author, own, time, text]),
    ).toEqual([
      ["Asha Rao", false, "11:30 am", "Earlier"],
      ["You", true, "11:31 am", "Mine"],
    ]);
  });

  it("GET /api/tasks/comments refuses a signed-out caller before the read", async () => {
    getCurrentMember.mockResolvedValueOnce(null);
    expect((await commentsGET(new Request(`${ORIGIN}/api/tasks/comments?task=t1`))).status).toBe(
      401,
    );
    expect(readEarlierComments).not.toHaveBeenCalled();
  });
});
