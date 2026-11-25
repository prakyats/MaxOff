"use client";

import { AfterPage } from "@/core/ui/lazy/after-page";
import { PwaAfterPage } from "@/core/ui/pwa/pwa-after-page";

import type { AfterPageProps } from "./after-page-lazy";

const loadTapDrawings = () => import("./tap-drawings").then((module) => module.TapDrawings);

/**
 * The shell's after-page part (`AppAfterPageLazy`): the service-worker helpers at once, and the
 * tap drawings at the next idle moment, in a chunk of their own, so the helpers never wait for the
 * drawings' code.
 */
export function AppAfterPage(props: AfterPageProps) {
  return (
    <>
      <PwaAfterPage role={props.role} />
      <AfterPage load={loadTapDrawings} props={props} />
    </>
  );
}
