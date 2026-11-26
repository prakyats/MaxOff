import type { ReactNode } from "react";

import {
  PRIVACY_NOTICE_INTRO,
  PRIVACY_NOTICE_SECTIONS,
  PRIVACY_QUESTIONS_HEADING,
  PRIVACY_QUESTIONS_LINE,
} from "../domain/notice";

/** Words drawn unseen, each line a bar: they wrap exactly as the page's own words do. */
const UNSEEN =
  "bg-muted rounded-md box-decoration-clone text-transparent select-none motion-safe:animate-pulse";

/**
 * The notice's words (v7.5 Q1, `domain/notice.ts`), as plain reading: a short intro, then each
 * section's heading over its paragraphs or bullets, then who to ask. Server-rendered, no data.
 * `unseen` draws the same words as bars for `me/privacy/loading.tsx`, so every line
 * wraps where the page's will and nothing moves when it arrives.
 */
export function PrivacyNotice({ unseen = false }: { unseen?: boolean }) {
  const words = (text: string): ReactNode =>
    unseen ? <span className={UNSEEN}>{text}</span> : text;
  return (
    <article
      data-slot={unseen ? "privacy-notice-loading" : "privacy-notice"}
      aria-hidden={unseen || undefined}
      className="max-w-prose space-y-6 text-base leading-relaxed"
    >
      <p>{words(PRIVACY_NOTICE_INTRO)}</p>
      {PRIVACY_NOTICE_SECTIONS.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-lg font-semibold">{words(section.heading)}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{words(paragraph)}</p>
          ))}
          {section.bullets ? (
            <ul className="list-disc space-y-1.5 pl-5">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{words(bullet)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{words(PRIVACY_QUESTIONS_HEADING)}</h2>
        <p data-slot="privacy-contact">{words(PRIVACY_QUESTIONS_LINE)}</p>
      </section>
    </article>
  );
}
