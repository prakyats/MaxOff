"use client";

import dynamic from "next/dynamic";
import { type ComponentProps, Suspense } from "react";

/**
 * Me's notification parts added in 5.5, each in its own chunk (owner decision 2026-10-03, 7: all
 * new client code lazy on Me, nothing added to any other screen's first load). Both still render
 * on the server, so their rows are in the first paint and nothing moves.
 *
 * **Each sits in its own Suspense boundary.** `next/dynamic` with server rendering adds none, so
 * a lazy part's chunk would hold the hydration of everything up to the page's loading boundary:
 * a tap on Me's other rows before it arrived went to a page that was not live yet (a link loaded
 * the whole document, a button did nothing). The boundary keeps the wait to the part itself.
 */
const DeviceListChunk = dynamic(() => import("./device-list").then((module) => module.DeviceList));

const OnboardingStepsChunk = dynamic(() =>
  import("./onboarding-steps").then((module) => module.OnboardingSteps),
);

export function DeviceList(props: ComponentProps<typeof DeviceListChunk>) {
  return (
    <Suspense>
      <DeviceListChunk {...props} />
    </Suspense>
  );
}

export function OnboardingSteps(props: ComponentProps<typeof OnboardingStepsChunk>) {
  return (
    <Suspense>
      <OnboardingStepsChunk {...props} />
    </Suspense>
  );
}
