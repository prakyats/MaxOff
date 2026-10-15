/**
 * The in-app guide's content shape (ROADMAP 6b.14). The guide is data: each role's topics live
 * in one typed file under `content/`, so a release that changes a screen updates that file in
 * the same PR (Definition of Done), and nothing here knows about React.
 */

/** Who a guide is written for: the three roles (CLAUDE.md invariant 1). */
export type GuideRole = "owner" | "admin" | "staff";

/**
 * One numbered step. With `shot`, a generated laptop screenshot (`pnpm guide:screenshots`) sits
 * beneath it with the step's button highlighted; the id is a key of `GUIDE_SHOTS`.
 */
export type GuideStep = string | { readonly text: string; readonly shot?: string };

/**
 * A paragraph, numbered steps, what happens next, a worked example, or a "Good to know" line.
 * A topic reads: what it's for (its summary), the steps, what happens next, good to know.
 */
export type GuideBlock =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "steps"; readonly steps: readonly GuideStep[] }
  /** Shown under "What happens next". */
  | { readonly kind: "next"; readonly text: string }
  /** Shown under an "Example:" label; names are neutral, never a real person or client. */
  | { readonly kind: "example"; readonly text: string }
  /** Shown as "Good to know": a common mistake or a rule people trip over. */
  | { readonly kind: "note"; readonly text: string };

/** A link into the real screen the topic describes. `href` is an app route the role can open. */
export type GuideLink = { readonly href: string; readonly label: string };

export type GuideTopic = {
  /** Stable, used as `/me/guide#<id>`: a screen's "How does this work?" link targets it. */
  readonly id: string;
  readonly title: string;
  /** One line: what the topic is for. Shown under the title when the topic is closed. */
  readonly summary: string;
  readonly blocks: readonly GuideBlock[];
  readonly link?: GuideLink;
  /** Extra words people search with that the text may not use ("approve", "holiday"). */
  readonly keywords?: readonly string[];
};

export type GuideSection = {
  readonly id: string;
  readonly title: string;
  readonly topics: readonly GuideTopic[];
};

export type Guide = {
  readonly role: GuideRole;
  readonly sections: readonly GuideSection[];
};
