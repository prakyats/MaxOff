import { describe, expect, it, vi } from "vitest";

import { WORKER_UNSAFE_INTEGRATIONS, workerSafeIntegrations } from "./server";

vi.mock("@sentry/nextjs", () => ({ init: vi.fn(), createTransport: vi.fn() }));

describe("workerSafeIntegrations", () => {
  const defaults = [
    { name: "InboundFilters" },
    { name: "ContextLines" },
    { name: "Http" },
    { name: "Modules" },
    { name: "LocalVariablesAsync" },
    { name: "Context" },
    { name: "RequestData" },
  ];

  it("drops every integration that reads the filesystem or the inspector", () => {
    expect(workerSafeIntegrations(defaults).map((i) => i.name)).toEqual([
      "InboundFilters",
      "Http",
      "RequestData",
    ]);
  });

  it("names exactly the four Node defaults that stall on Workers", () => {
    expect([...WORKER_UNSAFE_INTEGRATIONS].sort()).toEqual([
      "Context",
      "ContextLines",
      "LocalVariablesAsync",
      "Modules",
    ]);
  });
});
