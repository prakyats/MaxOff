"use client";

import { ArrowRightIcon, ChevronDownIcon, LightbulbIcon, SearchIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";

import { cn } from "@/core/lib/utils";
import { EmptyState } from "@/core/ui/composites/empty-state";
import { CARD_ROW_MIN_H, CARD_ROW_PADDING } from "@/core/ui/composites/row-metrics";
import { keyIntent } from "@/core/ui/keyboard/keys";
import { finePointer } from "@/core/ui/keyboard/pointer";
import { Input } from "@/core/ui/primitives/input";

import { searchGuide, stepText, topicCount } from "../domain/search";
import type {
  Guide,
  GuideBlock,
  GuideSection,
  GuideShot,
  GuideShots,
  GuideStep,
  GuideTopic,
} from "../domain/types";

/** A screenshot as the page shows it (one of the reader's `GuideShots`). */
export type GuideShotImage = GuideShot;

/**
 * The enlarged screenshot: a bottom sheet (back closes it, ARCHITECTURE §14.2), loaded on the
 * first tap so the guide's first load carries none of it.
 */
const ShotViewer = dynamic(() => import("./shot-viewer").then((module) => module.ShotViewer), {
  ssr: false,
});

/**
 * The reader's screenshots (only those their own guide's steps show, picked on the server:
 * `guideShotsFor`) and the opener of one large; provided by `GuideView`.
 */
const Shots = createContext<{ shots: GuideShots; view: (shot: GuideShotImage) => void }>({
  shots: {},
  view: () => {},
});

/** A search with this many matches or fewer opens them, so the answer is on the screen. */
const OPEN_WHEN_AT_MOST = 3;

/**
 * "How MaxOff works" (ROADMAP 6b.14): the reader's own guide, searchable, one collapsible row
 * per topic. The search and the open topics are **view controls** (ARCHITECTURE §14.2 d): they
 * never touch the URL or history, so the system back leaves the guide in one press. A link
 * `/me/guide#<topic>` (or `#<section>`) opens that topic and scrolls to it once, on arrival.
 * Each topic's own link is a real drill-down into the screen it describes.
 */
export function GuideView({ guide, shots }: { guide: Guide; shots: GuideShots }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // During a search the few matches start open; the reader may close them again.
  const [closedInSearch, setClosedInSearch] = useState<ReadonlySet<string>>(() => new Set());
  const searchId = useId();
  const [viewing, setViewing] = useState<GuideShotImage | null>(null);
  const shotsContext = useMemo(() => ({ shots, view: setViewing }), [shots]);

  const sections = useMemo(() => searchGuide(guide, query), [guide, query]);
  const searching = query.trim().length > 0;
  const matches = topicCount(sections);
  const autoOpen = searching && matches <= OPEN_WHEN_AT_MOST;

  // Arrival on `#<topic>` or `#<section>`: open it and bring it into view. Read once, and on a
  // later hash change (a "How does this work?" link while the guide is already open).
  useEffect(() => {
    const arrive = () => {
      const target = decodeURIComponent(window.location.hash.slice(1));
      if (!target) return;
      const topic = guide.sections.flatMap((s) => s.topics).find((t) => t.id === target);
      if (topic) setOpen((previous) => new Set(previous).add(topic.id));
      const known = topic || guide.sections.some((s) => s.id === target);
      if (!known) return;
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-guide-anchor="${CSS.escape(target)}"]`)
          ?.scrollIntoView({ block: "start" });
      });
    };
    arrive();
    window.addEventListener("hashchange", arrive);
    return () => window.removeEventListener("hashchange", arrive);
  }, [guide]);

  const isOpen = (id: string) =>
    autoOpen ? !closedInSearch.has(id) || open.has(id) : open.has(id);

  const toggle = (id: string) => {
    const opening = !isOpen(id);
    setOpen((previous) => {
      const next = new Set(previous);
      if (opening) next.add(id);
      else next.delete(id);
      return next;
    });
    if (autoOpen) {
      setClosedInSearch((previous) => {
        const next = new Set(previous);
        if (opening) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    setClosedInSearch(new Set());
  };

  return (
    <Shots.Provider value={shotsContext}>
      <div className="flex max-w-2xl flex-col gap-6" data-slot="guide" data-role={guide.role}>
        <div className="flex flex-col gap-2">
          <label htmlFor={searchId} className="sr-only">
            Search the guide
          </label>
          <div className="relative" data-slot="guide-search-box">
            <SearchIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id={searchId}
              data-slot="guide-search"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Search, e.g. leave, Done, install"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter keeps the text (the list already follows it); Escape clears; an empty box
                // lets Escape through (ARCHITECTURE §14.3 rule 6).
                const intent = keyIntent(event, {
                  field: "search",
                  finePointer: finePointer(),
                  value: query,
                });
                if (intent === "apply" || intent === "clear") event.preventDefault();
                if (intent === "clear") changeQuery("");
              }}
              className="h-11 pl-9"
            />
          </div>
          <p
            className="text-muted-foreground min-h-5 text-sm"
            data-slot="guide-count"
            aria-live="polite"
          >
            {searching
              ? matches === 1
                ? "1 topic matches"
                : `${matches} topics match`
              : `${topicCount(guide.sections)} topics in ${guide.sections.length} sections`}
          </p>
        </div>

        {searching && matches === 0 ? (
          <EmptyState
            icon={SearchIcon}
            title={`Nothing matches “${query.trim()}”`}
            description="Try a shorter word, or look under Help and troubleshooting."
            className="[&]:py-10"
          />
        ) : null}

        {sections.map((section) => (
          <SectionBlock key={section.id} section={section} isOpen={isOpen} toggle={toggle} />
        ))}
      </div>
      {viewing ? <ShotViewer shot={viewing} onClose={() => setViewing(null)} /> : null}
    </Shots.Provider>
  );
}

function SectionBlock({
  section,
  isOpen,
  toggle,
}: {
  section: GuideSection;
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}) {
  const headingId = `guide-section-${section.id}`;
  return (
    <section
      aria-labelledby={headingId}
      data-slot="guide-section"
      data-section={section.id}
      data-guide-anchor={section.id}
      className="flex scroll-mt-16 flex-col gap-2"
    >
      <h2 id={headingId} className="text-muted-foreground px-1 text-sm font-medium">
        {section.title}
      </h2>
      <ul className="border-border divide-border bg-card shadow-raised divide-y rounded-lg border">
        {section.topics.map((topic) => (
          <TopicRow
            key={topic.id}
            topic={topic}
            open={isOpen(topic.id)}
            onToggle={() => toggle(topic.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function TopicRow({
  topic,
  open,
  onToggle,
}: {
  topic: GuideTopic;
  open: boolean;
  onToggle: () => void;
}) {
  const bodyId = `guide-topic-${topic.id}`;
  return (
    <li
      data-slot="guide-topic"
      data-topic={topic.id}
      data-open={open ? "" : undefined}
      data-guide-anchor={topic.id}
      className="scroll-mt-16"
    >
      <button
        type="button"
        data-slot="guide-topic-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className={cn(
          "pressable-row focus-visible:ring-ring flex w-full items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset",
          CARD_ROW_MIN_H,
          CARD_ROW_PADDING,
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium break-words">{topic.title}</span>
          {open ? null : (
            <span className="text-muted-foreground truncate text-xs">{topic.summary}</span>
          )}
        </span>
        <ChevronDownIcon
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div
          id={bodyId}
          data-slot="guide-topic-body"
          className="flex flex-col gap-3 px-4 pt-1 pb-4 text-sm leading-relaxed"
        >
          <p data-slot="guide-purpose">
            <span className="font-medium">What it&apos;s for: </span>
            {topic.summary}
          </p>
          {topic.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
          {topic.link ? (
            <Link
              href={topic.link.href}
              data-slot="guide-link"
              className="pressable-row text-foreground inline-flex min-h-11 items-center gap-1.5 self-start font-medium underline underline-offset-4"
            >
              {topic.link.label}
              <ArrowRightIcon className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Block({ block }: { block: GuideBlock }) {
  if (block.kind === "steps") {
    return (
      <ol className="flex list-decimal flex-col gap-3 pl-5" data-slot="guide-steps">
        {block.steps.map((step, index) => (
          <Step key={index} step={step} />
        ))}
      </ol>
    );
  }
  if (block.kind === "next") {
    return (
      <p data-slot="guide-next">
        <span className="font-medium">What happens next: </span>
        {block.text}
      </p>
    );
  }
  if (block.kind === "example") {
    return (
      <p className="bg-muted/50 rounded-md px-3 py-2" data-slot="guide-example">
        <span className="font-medium">Example: </span>
        {block.text}
      </p>
    );
  }
  if (block.kind === "note") {
    return (
      <p className="text-muted-foreground flex gap-2" data-slot="guide-note">
        <LightbulbIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="text-foreground font-medium">Good to know: </span>
          {block.text}
        </span>
      </p>
    );
  }
  return <p>{block.text}</p>;
}

/**
 * One numbered step, and its screenshot beneath it when it has one: lazy, with its size set so
 * nothing moves as it arrives, scaled to the column's width; a tap opens it large.
 */
function Step({ step }: { step: GuideStep }) {
  const { shots, view } = useContext(Shots);
  const shot = typeof step === "string" || !step.shot ? undefined : shots[step.shot];
  return (
    <li className="pl-1">
      <span>{stepText(step)}</span>
      {shot ? (
        <button
          type="button"
          data-slot="guide-shot"
          onClick={() => view(shot)}
          aria-label={`Enlarge: ${shot.alt}`}
          className="pressable focus-visible:ring-ring border-border mt-2 block w-full overflow-hidden rounded-md border outline-none focus-visible:ring-2"
        >
          {/* A static, pre-sized WebP from `public/guide`: next/image would add nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shot.src}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            loading="lazy"
            decoding="async"
            className="block h-auto w-full"
          />
        </button>
      ) : null}
    </li>
  );
}
