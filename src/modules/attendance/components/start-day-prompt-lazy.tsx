"use client";

import { AfterPage } from "@/core/ui/lazy/after-page";

type Props = { memberId: string; workDate: string };

const loadPrompt = () => import("./start-day-prompt").then((module) => module.StartDayPrompt);

/**
 * The Start-day prompt (3b.1), **loaded after the page** (6.0, the first-load diet; ARCHITECTURE
 * §19): it draws nothing until its effect decides to open, so its dialog and leave choice stay
 * out of every screen's first-load JavaScript. The marker says the prompt is mounted (the layout
 * found the day unstarted) from the first paint, before the code arrives and opens it, so a test
 * can tell "not due" from "not open yet" without a timer.
 */
export function StartDayPromptLazy(props: Props) {
  return (
    <>
      <span hidden data-slot="start-day-prompt-mount" />
      <AfterPage load={loadPrompt} props={props} />
    </>
  );
}
