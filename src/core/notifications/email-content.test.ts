import { describe, expect, it } from "vitest";

import { escapeHtml, headerSafe, openUrl, renderNotificationEmail } from "./email-content";

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
