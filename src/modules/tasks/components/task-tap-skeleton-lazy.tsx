"use client";

import type { ComponentType } from "react";

import { AfterPage } from "@/core/ui/lazy/after-page";

type TapProps = { manages: boolean };

/** Once loaded, the component itself: every later screen that lists tasks draws it at once. */
let loaded: ComponentType<TapProps> | null = null;

const loadTaskTapSkeleton = () =>
  import("./task-tap-skeleton").then((module) => (loaded = module.TaskTapSkeleton));

/**
 * `TaskTapSkeleton` **loaded after the page** (ARCHITECTURE §19): it draws nothing until a tap
 * needs it, so it stays out of every screen's first-load JavaScript. Each screen that lists tasks
 * mounts it (not the shared layout: its loader there cost every screen's first load 318 bytes,
 * and the calendar had 159 left). The first screen after an open loads it once the browser is
 * idle (its listeners then stay for the page load, `TaskTapSkeleton`); a screen reached after
 * that renders it straight away, so its skeleton is drawn for that screen's viewer without a
 * second idle wait.
 */
export function TaskTapSkeletonLazy({ manages }: TapProps) {
  const Loaded = loaded;
  if (Loaded) return <Loaded manages={manages} />;
  return <AfterPage load={loadTaskTapSkeleton} props={{ manages }} />;
}
