import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DigestPayload } from "@/core/notifications/digest-content";

const { readDigestPreview } = vi.hoisted(() => ({ readDigestPreview: vi.fn() }));
vi.mock("@/core/notifications/digest-preview", () => ({ readDigestPreview }));

import { GET } from "./route";

const PAYLOAD: DigestPayload = {
  date: "2026-10-03",
  yesterday: "2026-10-02",
  attendance: {
    present: 1,
    on_leave: 0,
    absent: 0,
    absent_names: [],
    absent_more: 0,
    day_not_ended: 0,
    day_not_ended_names: [],
    day_not_ended_more: 0,
  },
  tasks: { approved_yesterday: 0, overdue: 2, waiting_for_owner: 0 },
  requests: { leave: 0, expense_claims: 0 },
  held_back: [],
  unreachable: { count: 0, names: [], more: 0 },
};

const request = () => new Request("http://localhost:3000/diagnostics/digest");

/** `notFound()` throws Next's 404 signal. */
async function expectNotFound(response: Promise<Response>) {
  await expect(response).rejects.toMatchObject({
    digest: expect.stringContaining("404") as unknown,
  });
}

describe("GET /diagnostics/digest", () => {
  beforeEach(() => {
    readDigestPreview.mockReset();
    readDigestPreview.mockResolvedValue(PAYLOAD);
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
    expect(html).toContain("Subject: Your morning summary · Sat 3 Oct");
    expect(html).toContain("Overdue now: 2");
    expect(html).toContain("http://localhost:3000/open?to=");
    expect(readDigestPreview).toHaveBeenCalledTimes(1);
  });

  it("404s on production, before reading anything", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    await expectNotFound(GET(request()));
    expect(readDigestPreview).not.toHaveBeenCalled();
  });

  it("404s on the production Worker (CANONICAL_HOST at runtime) even from a staging build", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example");
    vi.stubEnv("CANONICAL_HOST", "app.maxoff.in");
    await expectNotFound(GET(request()));
    expect(readDigestPreview).not.toHaveBeenCalled();
  });

  it("404s for anyone the database refuses (an Admin, Crew, signed out)", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example");
    readDigestPreview.mockResolvedValue(null);
    await expectNotFound(GET(request()));
  });
});
