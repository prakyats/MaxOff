import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WeeklyDigestPayload } from "@/core/notifications/weekly-digest-content";

const { readWeeklyDigestPreview } = vi.hoisted(() => ({ readWeeklyDigestPreview: vi.fn() }));
vi.mock("@/core/notifications/digest-preview", () => ({ readWeeklyDigestPreview }));

import { GET } from "./route";

const PAYLOAD: WeeklyDigestPayload = {
  date: "2026-10-12",
  week: { from: "2026-10-05", to: "2026-10-11" },
  days: [
    {
      date: "2026-10-05",
      report_id: "11111111-1111-4111-8111-111111111111",
      saved: true,
      present: 4,
      on_leave: 0,
      absent: 0,
      end_not_recorded: 0,
      overtime: 0,
      completed: 1,
      cancelled: 0,
      created: 0,
      decisions: 0,
      holiday: null,
      weekly_off: false,
    },
  ],
  totals: {
    present: 4,
    on_leave: 0,
    absent: 0,
    end_not_recorded: 0,
    overtime: 0,
    completed: 1,
    cancelled: 0,
    created: 0,
    decisions: 0,
    missing: 0,
  },
  now: {
    waiting: { tasks: 0, leave: 0, expense_claims: 0, attendance: 0, extra_work: 0 },
    overdue: 2,
    unreachable: { count: 0, names: [], more: 0 },
  },
  ahead: { from: "2026-10-12", to: "2026-10-18", leave: [], events: [], holidays: [] },
  client_work: [],
};

const request = () => new Request("http://localhost:3000/diagnostics/digest");

/** `notFound()` throws Next's 404 signal. */
async function expectNotFound(response: Promise<Response>) {
  await expect(response).rejects.toMatchObject({
    digest: expect.stringContaining("404") as unknown,
  });
}

describe("GET /diagnostics/digest (the weekly digest since 6.5)", () => {
  beforeEach(() => {
    readWeeklyDigestPreview.mockReset();
    readWeeklyDigestPreview.mockResolvedValue(PAYLOAD);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the Owner's sample on a local build", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "");
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const html = await response.text();
    expect(html).toContain("Subject: Your week · 5 – 11 Oct");
    expect(html).toContain("Overdue now: 2");
    expect(html).toContain("http://localhost:3000/open?to=");
    expect(readWeeklyDigestPreview).toHaveBeenCalledTimes(1);
  });

  it("404s on production, before reading anything", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    await expectNotFound(GET(request()));
    expect(readWeeklyDigestPreview).not.toHaveBeenCalled();
  });

  it("404s on the production Worker (CANONICAL_HOST at runtime) even from a staging build", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example");
    vi.stubEnv("CANONICAL_HOST", "app.maxoff.in");
    await expectNotFound(GET(request()));
    expect(readWeeklyDigestPreview).not.toHaveBeenCalled();
  });

  it("404s for anyone the database refuses (an Admin, Crew, signed out)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example");
    readWeeklyDigestPreview.mockResolvedValue(null);
    await expectNotFound(GET(request()));
  });
});
