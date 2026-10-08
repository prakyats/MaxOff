import { describe, expect, it } from "vitest";

import {
  byUrgency,
  escapeHtml,
  headerSafe,
  openUrl,
  renderCombinedEmail,
  renderNotificationEmail,
} from "./email-content";

const ORIGIN = "https://app.example";

describe("headerSafe (the subject)", () => {
  it("turns CR, LF and every other control character into one space: no header can start", () => {
    expect(headerSafe("Reel cut\r\nBcc: victim@example.com")).toBe(
      "Reel cut Bcc: victim@example.com",
    );
    expect(headerSafe("A\nB\rC\tD\u0000E\u0085F G H")).toBe("A B C D E F G H");
    expect(headerSafe("Reel cut\r\n")).not.toMatch(/[\r\n]/);
  });

  it("collapses runs of spaces, trims, cuts long titles and is never empty", () => {
    expect(headerSafe("  New   task:  Reel  ")).toBe("New task: Reel");
    const long = headerSafe("x".repeat(400));
    expect(long).toHaveLength(150);
    expect(long.endsWith("…")).toBe(true);
    expect(headerSafe(" \r\n ")).toBe("MaxOff");
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters that matter in text and attributes", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });
});

describe("openUrl", () => {
  it("opens the row's link through the deep-link entry, the history otherwise", () => {
    expect(openUrl(ORIGIN, "/tasks/1?tab=chat")).toBe(
      "https://app.example/open?to=%2Ftasks%2F1%3Ftab%3Dchat",
    );
    expect(openUrl(ORIGIN, null)).toBe("https://app.example/open?to=%2Fnotifications");
    expect(openUrl(ORIGIN, "//evil.example/x")).toBe(
      "https://app.example/open?to=%2Fnotifications",
    );
    expect(openUrl(ORIGIN, "https://evil.example")).toBe(
      "https://app.example/open?to=%2Fnotifications",
    );
  });
});

describe("renderNotificationEmail", () => {
  const hostile = {
    title: 'New task: <img src=x onerror="alert(1)">\r\nBcc: someone@example.com',
    body: 'Ravi: <a href="https://evil.example">click</a> & "quotes"\n\nSecond part',
    link: "/tasks/1",
    origin: ORIGIN,
  };

  it("escapes every user-entered string in the HTML part", () => {
    const { html } = renderNotificationEmail(hostile);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt; &amp;");
    // Paragraphs follow the body's blank lines.
    expect(html).toContain("Second part</p>");
  });

  it("keeps the subject on one line and the button on the deep link", () => {
    const email = renderNotificationEmail(hostile);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.startsWith("New task: <img")).toBe(true);
    expect(email.html).toContain('href="https://app.example/open?to=%2Ftasks%2F1"');
    expect(email.text).toContain("Open in MaxOff: https://app.example/open?to=%2Ftasks%2F1");
  });

  it("says the title, the body and the link in the text part; no body, no empty lines", () => {
    const email = renderNotificationEmail({
      title: "Leave approved",
      body: null,
      link: "/leave",
      origin: ORIGIN,
    });
    expect(email.text.split("\n").slice(0, 3)).toEqual([
      "Leave approved",
      "",
      "Open in MaxOff: https://app.example/open?to=%2Fleave",
    ]);
    expect(email.html).toContain(">Leave approved</h1>");
  });
});

describe("renderCombinedEmail (5.3)", () => {
  const item = (kind: string, title: string, escalationLevel = 0) => ({
    kind,
    title,
    body: `${title} body`,
    link: "/tasks/1",
    escalationLevel,
  });

  it("orders an escalation first, then overdue, then before-due, then the rest", () => {
    const ordered = byUrgency([
      item("reminder_event", "Event"),
      item("reminder_before_due_last", "Soon"),
      item("reminder_overdue", "Late"),
      item("escalation_overdue", "Escalated", 2),
    ]);
    expect(ordered.map((entry) => entry.title)).toEqual(["Escalated", "Late", "Soon", "Event"]);
  });

  it("ranks the client-item overdue notice with overdue and its escalations first (amendment C)", () => {
    const ordered = byUrgency([
      item("reminder_event", "Event"),
      item("reminder_item_overdue", "Item late"),
      item("escalation_delivery_missed", "Past delivery", 1),
    ]);
    expect(ordered.map((entry) => entry.title)).toEqual(["Past delivery", "Item late", "Event"]);
  });

  it("names the most urgent in the subject with how many more, and lists every item", () => {
    const email = renderCombinedEmail({
      items: [item("reminder_before_due_last", "Soon"), item("reminder_overdue", "Late")],
      origin: ORIGIN,
    });
    expect(email.subject).toBe("Late · +1 more");
    expect(email.text).toContain("Soon body");
    expect(email.text).toContain("Late body");
    expect(email.html.match(/Open in MaxOff/g)).toHaveLength(2);
  });

  it("escapes every item and keeps the subject header-safe", () => {
    const email = renderCombinedEmail({
      items: [
        item("reminder_overdue", "<b>Late</b>\r\nBcc: x@example.com"),
        item("reminder_event", "Ok"),
      ],
      origin: ORIGIN,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).not.toContain("<b>Late</b>");
    expect(email.html).toContain("&lt;b&gt;Late&lt;/b&gt;");
  });

  it("a single item is the ordinary email", () => {
    const one = renderCombinedEmail({ items: [item("reminder_overdue", "Late")], origin: ORIGIN });
    expect(one).toEqual(
      renderNotificationEmail({
        title: "Late",
        body: "Late body",
        link: "/tasks/1",
        origin: ORIGIN,
      }),
    );
  });
});
