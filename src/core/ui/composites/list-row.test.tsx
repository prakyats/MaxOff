import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatCount, chatCountLabel, ListRow, rowParts } from "./list-row";

/** The one row anatomy (FINAL 5) and the truncation rule (owner, comment 6322342277). */
describe("rowParts", () => {
  it("draws › and cuts the text only when the row opens", () => {
    expect(rowParts({ opens: true, actions: false })).toEqual({
      chevron: true,
      menu: false,
      truncate: true,
    });
    expect(rowParts({ opens: false, actions: false })).toEqual({
      chevron: false,
      menu: false,
      truncate: false,
    });
  });

  it("draws ⋯ when the row has actions, opening or not", () => {
    expect(rowParts({ opens: true, actions: true }).menu).toBe(true);
    expect(rowParts({ opens: false, actions: true }).menu).toBe(true);
  });
});

describe("ListRow", () => {
  const html = (props: Parameters<typeof ListRow>[0]) =>
    renderToStaticMarkup(<ListRow {...props} />);

  it("never truncates a row that opens nothing (the full text wraps)", () => {
    const out = html({ title: "A long title", meta: "Asha · today" });
    expect(out).not.toContain("truncate");
    expect(out).toContain("break-words");
    expect(out).not.toContain('data-slot="list-row-open"');
  });

  it("an opening row is one line with an ellipsis, then chips, then ⋯ before ›", () => {
    const out = html({
      title: "Edit",
      onOpen: () => undefined,
      chips: <span data-slot="chip">3 days late</span>,
      actions: <button type="button">⋯</button>,
    });
    expect(out).toContain("truncate");
    const chips = out.indexOf('data-slot="list-row-chips"');
    const menu = out.indexOf('data-slot="list-row-actions"');
    const open = out.indexOf('data-slot="list-row-open"');
    expect(chips).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(chips);
    expect(open).toBeGreaterThan(menu);
  });

  it("puts the chat count beside the title, not among the chips", () => {
    const out = html({
      title: "Edit",
      titleBadge: <ChatCount count={2} />,
      chips: <span>In progress</span>,
    });
    const title = out.indexOf('data-slot="list-row-title"');
    const badge = out.indexOf('data-slot="chat-count"');
    const chips = out.indexOf('data-slot="list-row-chips"');
    expect(badge).toBeGreaterThan(title);
    expect(badge).toBeLessThan(chips);
  });
});

describe("ChatCount", () => {
  it("is nothing at zero, speaks its words and caps at 99+", () => {
    expect(renderToStaticMarkup(<ChatCount count={0} />)).toBe("");
    expect(chatCountLabel(1)).toBe("1 new comment");
    expect(chatCountLabel(3)).toBe("3 new comments");
    const out = renderToStaticMarkup(<ChatCount count={120} />);
    expect(out).toContain("99+");
    expect(out).toContain("120 new comments");
  });
});
