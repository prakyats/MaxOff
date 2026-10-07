import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { getCurrentMember } = vi.hoisted(() => ({ getCurrentMember: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));

import { AppError } from "@/core/errors";

import { backgroundGet, backgroundPost, statusOf } from "./background-route";

const ORIGIN = "https://app.example";

function post(body: unknown, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  return new Request(`${ORIGIN}/api/x`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** ARCHITECTURE §4.4: the route handlers behind the app's background calls. */
describe("background route handlers (core/http/background-route)", () => {
  const schema = z.object({ id: z.uuid() });
  const ID = "6f1c2c1e-3a0b-4c4e-9a43-0d3f1c2b9e10";

  beforeEach(() => {
    getCurrentMember.mockReset().mockResolvedValue({ id: "m1" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers each code with its status", () => {
    expect(statusOf({ ok: true, data: null })).toBe(200);
    const codes = {
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      VALIDATION: 400,
      CONFLICT: 409,
      INVALID_STATE: 409,
      REASON_REQUIRED: 400,
      RATE_LIMITED: 429,
      INTERNAL: 500,
    } as const;
    for (const [code, status] of Object.entries(codes)) {
      expect(
        statusOf({ ok: false, error: { code: code as keyof typeof codes, message: "" } }),
      ).toBe(status);
    }
  });

  describe("GET", () => {
    it("reads the query and answers the Result, never cached", async () => {
      const read = vi.fn(async (query: URLSearchParams) => ({ members: query.getAll("member") }));
      const response = await backgroundGet(read)(new Request(`${ORIGIN}/api/x?member=a&member=b`));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ ok: true, data: { members: ["a", "b"] } });
    });

    it("refuses a caller who is not an active member before anything runs", async () => {
      getCurrentMember.mockResolvedValue(null);
      const read = vi.fn(async () => 1);
      const response = await backgroundGet(read)(new Request(`${ORIGIN}/api/x`));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "UNAUTHENTICATED" },
      });
      expect(read).not.toHaveBeenCalled();
    });

    it("a query zod refuses is a 400 with the fields", async () => {
      const read = async (query: URLSearchParams) => schema.parse({ id: query.get("id") });
      const response = await backgroundGet(read)(new Request(`${ORIGIN}/api/x?id=nope`));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "VALIDATION", fieldErrors: { id: expect.any(Array) } },
      });
    });

    it("a refusal of the module's own check keeps its code", async () => {
      const read = async () => {
        throw new AppError("FORBIDDEN");
      };
      const response = await backgroundGet(read)(new Request(`${ORIGIN}/api/x`));
      expect(response.status).toBe(403);
    });

    it("an unexpected failure is a 500 that names nothing", async () => {
      const read = async () => {
        throw new Error("relation members: secret detail");
      };
      const response = await backgroundGet(read)(new Request(`${ORIGIN}/api/x`));
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("secret");
    });
  });

  describe("POST", () => {
    it("hands the parsed body to the write and answers the Result", async () => {
      const write = vi.fn(async (body: unknown) => schema.parse(body));
      const response = await backgroundPost(write)(post({ id: ID }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: { id: ID } });
      expect(write).toHaveBeenCalledWith({ id: ID });
    });

    it("refuses another origin, or none, before the session or the body is read", async () => {
      const write = vi.fn(async () => null);
      for (const origin of ["https://evil.example", "null", null]) {
        const response = await backgroundPost(write)(post({ id: ID }, origin));
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      }
      expect(getCurrentMember).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });

    it("refuses a caller who is not an active member", async () => {
      getCurrentMember.mockResolvedValue(null);
      const write = vi.fn(async () => null);
      expect((await backgroundPost(write)(post({ id: ID }))).status).toBe(401);
      expect(write).not.toHaveBeenCalled();
    });

    it("a body that is not JSON reaches the write as null, which its zod refuses", async () => {
      const write = vi.fn(async (body: unknown) => schema.parse(body));
      const response = await backgroundPost(write)(post("{not json"));
      expect(write).toHaveBeenCalledWith(null);
      expect(response.status).toBe(400);
    });
  });
});
