import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentMember, readUnread, markRecord, appReport, upsert } = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  readUnread: vi.fn(),
  markRecord: vi.fn(),
  appReport: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/core/auth/server", () => ({ getCurrentMember }));
vi.mock("@/core/observability/capture", () => ({ captureException: () => "event-1" }));
vi.mock("@/core/notifications/inbox", () => ({
  readUnread,
  rpcMarkRecordRead: markRecord,
}));
vi.mock("@/core/notifications/reachability-store", () => ({ rpcAppOpenReport: appReport }));
vi.mock("@/core/notifications/push/subscriptions", () => ({ rpcPushSubscriptionUpsert: upsert }));

import { systemClock } from "@/core/time";

import { POST as appReportPOST } from "../app-report/route";
import { POST as subscriptionPOST } from "../push/subscription/route";
import { POST as readRecordPOST } from "./read-record/route";
import { GET as unreadGET } from "./unread/route";

const ORIGIN = "https://app.example";
const ID = "6f1c2c1e-3a0b-4c4e-9a43-0d3f1c2b9e10";

function post(path: string, body: unknown, origin: string | null = ORIGIN): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const subscription = {
  endpoint: "https://push.example/phone",
  p256dh: `B${"A".repeat(86)}`,
  auth: "A".repeat(22),
  platform: "android",
  isStandalone: false,
  label: null,
  userAgent: null,
};

/**
 * The notification area's background calls (ARCHITECTURE §4.4): the route handlers that replaced
 * the server actions `readUnreadCount`, `markRecordRead`, `reportAppOpen` and `subscribePush`.
 */
describe("the notification area's background routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentMember.mockResolvedValue({ id: "m1" });
    readUnread.mockResolvedValue({ count: 4, countedAt: 1000 });
    markRecord.mockResolvedValue(2);
    appReport.mockResolvedValue(undefined);
    upsert.mockResolvedValue("s1");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("GET /api/notifications/unread", () => {
    it("answers the bell's count with when it was counted", async () => {
      const response = await unreadGET(new Request(`${ORIGIN}/api/notifications/unread`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: { count: 4, countedAt: 1000 } });
    });

    it("refuses a signed-out caller before any read", async () => {
      getCurrentMember.mockResolvedValue(null);
      const response = await unreadGET(new Request(`${ORIGIN}/api/notifications/unread`));
      expect(response.status).toBe(401);
      expect(readUnread).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/notifications/read-record", () => {
    const path = "/api/notifications/read-record";

    it("marks the member's rows about the record, with the server's clock after the write", async () => {
      const before = systemClock().getTime();
      const response = await readRecordPOST(post(path, { entity: "tasks", id: ID }));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ok: true;
        data: { marked: number; writtenAt: number };
      };
      expect(body.data.marked).toBe(2);
      expect(body.data.writtenAt).toBeGreaterThanOrEqual(before);
      expect(markRecord).toHaveBeenCalledWith("tasks", ID);
    });

    it("refuses another origin, a signed-out caller and what zod refuses, before the write", async () => {
      expect(
        (await readRecordPOST(post(path, { entity: "tasks", id: ID }, "https://evil.example")))
          .status,
      ).toBe(403);
      getCurrentMember.mockResolvedValueOnce(null);
      expect((await readRecordPOST(post(path, { entity: "tasks", id: ID }))).status).toBe(401);
      for (const body of [{ entity: "leave_requests", id: ID }, { entity: "tasks", id: "x" }, {}]) {
        expect((await readRecordPOST(post(path, body))).status).toBe(400);
      }
      expect(markRecord).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/app-report", () => {
    const path = "/api/app-report";

    it("stores the open's report", async () => {
      const response = await appReportPOST(post(path, { platform: "ios", isStandalone: true }));
      expect(await response.json()).toEqual({ ok: true, data: null });
      expect(appReport).toHaveBeenCalledWith({ platform: "ios", isStandalone: true });
    });

    it("refuses another origin, a signed-out caller and what zod refuses, before the write", async () => {
      const report = { platform: "ios", isStandalone: true };
      expect((await appReportPOST(post(path, report, null))).status).toBe(403);
      getCurrentMember.mockResolvedValueOnce(null);
      expect((await appReportPOST(post(path, report))).status).toBe(401);
      expect(
        (await appReportPOST(post(path, { platform: "symbian", isStandalone: true }))).status,
      ).toBe(400);
      expect(appReport).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/push/subscription", () => {
    const path = "/api/push/subscription";

    it("stores the device's subscription with the automatic upsert", async () => {
      const response = await subscriptionPOST(post(path, subscription));
      expect(await response.json()).toEqual({ ok: true, data: { id: "s1" } });
      expect(upsert).toHaveBeenCalledWith(subscription);
    });

    it("a device removed from Me's list stays off: 409 INVALID_STATE (owner 2026-10-06)", async () => {
      upsert.mockRejectedValue({
        code: "P0001",
        message: "INVALID_STATE",
        details: "This device was removed from your devices.",
      });
      const response = await subscriptionPOST(post(path, subscription));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
    });

    it("refuses another origin (phase 5 review), a signed-out caller and what zod refuses", async () => {
      expect(
        (await subscriptionPOST(post(path, subscription, "https://evil.example"))).status,
      ).toBe(403);
      getCurrentMember.mockResolvedValueOnce(null);
      expect((await subscriptionPOST(post(path, subscription))).status).toBe(401);
      expect(
        (await subscriptionPOST(post(path, { ...subscription, endpoint: "nope" }))).status,
      ).toBe(400);
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
