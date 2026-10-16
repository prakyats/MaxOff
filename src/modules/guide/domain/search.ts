import type { Guide, GuideBlock, GuideSection, GuideStep, GuideTopic } from "./types";

/** A step's words, whether it is plain text or carries a screenshot. */
export function stepText(step: GuideStep): string {
  return typeof step === "string" ? step : step.text;
}

function blockText(block: GuideBlock): string {
  return block.kind === "steps" ? block.steps.map(stepText).join(" ") : block.text;
}

/** Lower case, accents and punctuation folded to spaces, so "Task Noted" finds "task-noted". */
export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9×]+/g, " ")
    .trim();
}

/** Everything a topic can be found by: its title, summary, keywords, text and section. */
export function topicHaystack(topic: GuideTopic, section: GuideSection): string {
  return normalise(
    [
      section.title,
      topic.title,
      topic.summary,
      ...(topic.keywords ?? []),
      ...topic.blocks.map(blockText),
      topic.link?.label ?? "",
    ].join(" "),
  );
}

/**
 * The sections and topics a search keeps: a topic matches when every word of the query is in
 * it (in any order), so "leave half" finds the half-day leave topic. An empty query keeps all.
 * Sections with no match are dropped; order is unchanged.
 */
export function searchGuide(guide: Guide, query: string): readonly GuideSection[] {
  const words = normalise(query).split(" ").filter(Boolean);
  if (words.length === 0) return guide.sections;
  return guide.sections
    .map((section) => ({
      ...section,
      topics: section.topics.filter((topic) => {
        const haystack = topicHaystack(topic, section);
        return words.every((word) => haystack.includes(word));
      }),
    }))
    .filter((section) => section.topics.length > 0);
}

/** How many topics a list of sections holds. */
export function topicCount(sections: readonly GuideSection[]): number {
  return sections.reduce((sum, section) => sum + section.topics.length, 0);
}
