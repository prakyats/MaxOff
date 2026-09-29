import { Fragment } from "react";

import { cn } from "@/core/lib/utils";

import { linkSegments } from "../domain/links";

/**
 * Text that may carry links (a Done note, a comment, a description; kickoff 4 decision 10): the
 * `http`/`https` addresses become links the reviewer taps, opening in a new tab with
 * `rel="noopener noreferrer"`, and everything else stays text. No markup is ever read from it:
 * each segment is rendered as a React text node or an anchor built here. A server component.
 */
export function LinkedText({
  text,
  className,
  slot,
}: {
  text: string;
  className?: string;
  slot?: string;
}) {
  return (
    <p data-slot={slot} className={cn("break-words whitespace-pre-wrap", className)}>
      {linkSegments(text).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            data-slot="task-link"
            className="text-foreground font-medium break-all underline underline-offset-2"
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </p>
  );
}
