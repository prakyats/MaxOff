import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { SCRUBBED, scrubBreadcrumb, scrubEvent, scrubString, scrubUrl, scrubValue } from "./scrub";

describe("scrubString", () => {
  it("replaces rupee amounts and keeps the rest of the message", () => {
    expect(scrubString("Paid ₹12,000 on Monday")).toBe(`Paid ${SCRUBBED} on Monday`);
    expect(scrubString("Rs. 500 due")).toBe(`${SCRUBBED} due`);
    expect(scrubString("Rs 500")).toBe(SCRUBBED);
    expect(scrubString("Total INR 12,000")).toBe(`Total ${SCRUBBED}`);
    expect(scrubString("₹")).toBe(SCRUBBED);
  });

  it("replaces email addresses and Indian phone numbers", () => {
    expect(scrubString("Key (email)=(a.b+c@pixora.in) already exists")).toBe(
      `Key (email)=(${SCRUBBED}) already exists`,
    );
    expect(scrubString("Call +91 98765 43210".replace(" 43210", "43210"))).toBe(`Call ${SCRUBBED}`);
    expect(scrubString("Phone 9876543210 invalid")).toBe(`Phone ${SCRUBBED} invalid`);
  });

  it("keeps ordinary text, ids and short numbers", () => {
    expect(scrubString("Shoot at Rsvp Studio")).toBe("Shoot at Rsvp Studio");
    expect(scrubString("Task Noted")).toBe("Task Noted");
    expect(scrubString("task 12345 in state submitted")).toBe("task 12345 in state submitted");
  });
});

describe("scrubUrl", () => {
  it("drops query strings and fragments", () => {
    expect(scrubUrl("https://maxoff.example/reports?client=Acme&min_amount=5000#x")).toBe(
      "https://maxoff.example/reports",
    );
    expect(scrubUrl("/search?q=%E2%82%B912000")).toBe("/search");
    expect(scrubUrl("/tasks/42")).toBe("/tasks/42");
  });

  it("scrubs a string that is not a URL at all", () => {
    expect(scrubUrl("http://")).toBe(SCRUBBED);
  });
});

describe("scrubValue", () => {
  it("replaces financial keys at any depth, in objects and arrays", () => {
    const input = {
      task: { title: "Edit reel", client: "Acme" },
      project: { billing_category: "retainer", items: [{ id: 1, amount: 5000 }] },
      meta: { nested: { deeper: { totalValue: 12 } } },
      rates: [{ rate: 1 }],
    };
    expect(scrubValue(input)).toEqual({
      task: { title: "Edit reel", client: "Acme" },
      project: { billing_category: SCRUBBED, items: [{ id: 1, amount: SCRUBBED }] },
      meta: { nested: { deeper: { totalValue: SCRUBBED } } },
      rates: SCRUBBED,
    });
  });

  it("scrubs strings wherever they sit", () => {
    expect(scrubValue({ note: "a@b.co paid ₹5", list: ["Rs 9"] })).toEqual({
      note: `${SCRUBBED} paid ${SCRUBBED}`,
      list: [SCRUBBED],
    });
  });

  it("leaves numbers, booleans and null alone", () => {
    expect(scrubValue({ count: 3, ok: true, none: null })).toEqual({
      count: 3,
      ok: true,
      none: null,
    });
  });

  it("stops at a depth limit instead of recursing forever", () => {
    type Deep = { next?: Deep };
    const deep: Deep = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(JSON.stringify(scrubValue(deep))).toContain(SCRUBBED);
  });
});

describe("scrubBreadcrumb", () => {
  it("keeps only method, status and path on network breadcrumbs", () => {
    const crumb: Breadcrumb = {
      category: "fetch",
      data: {
        method: "POST",
        status_code: 200,
        url: "https://x.supabase.co/rest/v1/items?amount=gt.5000",
        request_body: '{"amount":1}',
        response_body_size: 12,
      },
    };
    expect(scrubBreadcrumb(crumb).data).toEqual({
      method: "POST",
      status_code: 200,
      url: "https://x.supabase.co/rest/v1/items",
    });
  });

  it("reduces navigation breadcrumbs to paths", () => {
    const crumb: Breadcrumb = {
      category: "navigation",
      data: { from: "/reports?client=Acme", to: "/tasks/1?value=9" },
    };
    expect(scrubBreadcrumb(crumb).data).toEqual({ from: "/reports", to: "/tasks/1" });
  });

  it("scrubs financial keys and messages on other breadcrumbs", () => {
    const crumb: Breadcrumb = {
      category: "ui.click",
      message: "Approve ₹4,000",
      data: { label: "Approve", amount: 4000 },
    };
    expect(scrubBreadcrumb(crumb)).toEqual({
      category: "ui.click",
      message: `Approve ${SCRUBBED}`,
      data: { label: "Approve", amount: SCRUBBED },
    });
  });
});

describe("scrubEvent", () => {
  it("drops request bodies, form data, cookies, headers and the query string", () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: "https://maxoff.example/tasks?value=9",
        method: "POST",
        data: { amount: 1, note: "x" },
        cookies: { session: "abc" },
        headers: { authorization: "Bearer x" },
        query_string: "value=9",
      },
    };
    expect(scrubEvent(event).request).toEqual({
      url: "https://maxoff.example/tasks",
      method: "POST",
    });
  });

  it("reduces the user to a member id only", () => {
    const event: ErrorEvent = {
      type: undefined,
      user: { id: "m1", email: "a@b.c", username: "a", ip_address: "1.2.3.4" },
    };
    expect(scrubEvent(event).user).toEqual({ id: "m1" });
    expect(scrubEvent({ type: undefined, user: { email: "a@b.c" } }).user).toEqual({});
  });

  it("scrubs extra, contexts, tags, breadcrumbs, message and exception values", () => {
    const event: ErrorEvent = {
      type: undefined,
      message: "Item worth ₹10",
      extra: { item: { id: 7, price: 10 } },
      contexts: { form: { revenue: 1, note: "ok" } },
      tags: { runtime: "server", billing: "x" },
      breadcrumbs: [{ category: "log", data: { amount: 2 } }],
      exception: {
        values: [
          { type: "Error", value: "duplicate key: Key (email)=(a@b.co) exists" },
          { type: "Error" },
        ],
      },
    };
    const out = scrubEvent(event);
    expect(out.message).toBe(`Item worth ${SCRUBBED}`);
    expect(out.extra).toEqual({ item: { id: 7, price: SCRUBBED } });
    expect(out.contexts).toEqual({ form: { revenue: SCRUBBED, note: "ok" } });
    expect(out.tags).toEqual({ runtime: "server", billing: SCRUBBED });
    expect(out.breadcrumbs).toEqual([{ category: "log", data: { amount: SCRUBBED } }]);
    expect(out.exception?.values).toEqual([
      { type: "Error", value: `duplicate key: Key (email)=(${SCRUBBED}) exists` },
      { type: "Error" },
    ]);
  });

  it("does not mutate the original event", () => {
    const event: ErrorEvent = { type: undefined, extra: { amount: 1 } };
    scrubEvent(event);
    expect(event.extra).toEqual({ amount: 1 });
  });
});
