/**
 * The links in a task's text (kickoff 4 decision 10, WORKFLOWS §3.3): a Done note may carry
 * `http`/`https` links, the hand-in until phase 8, and the reviewer taps them. The text is split
 * into plain runs and links; the screen renders a link as an anchor and everything else as text,
 * so nothing in a note is ever read as markup. Only `http:` and `https:` become links: a
 * `javascript:` or `data:` address stays plain text.
 */

export type TextSegment =
  { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

/** A run that starts like a web address and stops at whitespace or a quote or angle bracket. */
const CANDIDATE = /https?:\/\/[^\s<>"'`]+/gi;

/** Punctuation that ends a sentence rather than the address it follows. */
const TRAILING = /[.,;:!?'"]+$/;

/** A closing bracket belongs to the address only when the address opened one. */
function trimClosing(url: string): string {
  let result = url;
  for (;;) {
    const withoutPunctuation = result.replace(TRAILING, "");
    const last = withoutPunctuation.at(-1);
    const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    const opener = last ? pairs[last] : undefined;
    if (opener !== undefined) {
      const opened = withoutPunctuation.split(opener).length - 1;
      const closed = withoutPunctuation.split(last as string).length - 1;
      if (closed > opened) {
        result = withoutPunctuation.slice(0, -1);
        continue;
      }
    }
    return withoutPunctuation;
  }
}

/** The address a link opens, or null when it is not a well-formed http or https URL. */
export function safeHref(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Splits `text` into plain runs and http/https links, in order; adjacent text is merged. */
export function linkSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments.at(-1);
    if (last?.kind === "text") last.text += value;
    else segments.push({ kind: "text", text: value });
  };
  let cursor = 0;
  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index;
    const raw = trimClosing(match[0]);
    const href = safeHref(raw);
    pushText(text.slice(cursor, start));
    if (href) segments.push({ kind: "link", text: raw, href });
    else pushText(raw);
    cursor = start + raw.length;
  }
  pushText(text.slice(cursor));
  return segments;
}

/** True when the text carries at least one link (a hand-in to open). */
export function hasLink(text: string | null | undefined): boolean {
  return text ? linkSegments(text).some((segment) => segment.kind === "link") : false;
}
