"use client";

import { CheckIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/core/lib/utils";
import { ActionStatus } from "@/core/ui/action/action-status";
import { useAction } from "@/core/ui/action/use-action";
import { Button } from "@/core/ui/primitives/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/primitives/card";
import { toastResult } from "@/core/ui/toast";

import { finishOnboarding, sendTestPush } from "../actions";
import { browserSubscription, currentPermission, currentSupport } from "../push/browser";
import { testOutcome } from "../push/test-outcome";
import { turnOnHere } from "../push/turn-on";
import { InstallSteps } from "./install-steps";

const DidItArrive = dynamic(() => import("./did-it-arrive").then((module) => module.DidItArrive), {
  ssr: false,
});

/**
 * A new joiner's first-login walkthrough on the welcome screen (task 5.5, owner decisions
 * 2026-10-03, 3 and 4): **(a)** on an iPhone in Safari, install MaxOff (numbered steps with
 * pictures); **(b)** turn on notifications; **(c)** send a test, then "Did it arrive?". **Later**
 * ends it for good; skipped or not, the band keeps nudging until push works. Finished by the
 * test once a device of theirs received it (`onboarding_finish('test')`) or by Later.
 *
 * **The iPhone split** (decision 4): the installed app keeps its own sign-in, so the joiner signs
 * in again there, lands back here, and the walkthrough resumes at "Turn on notifications".
 *
 * The step comes from the device: an iPhone outside the installed app installs; a device with no
 * notifications here turns them on; one that has them sends the test. The server knows only
 * whether it is an iPhone (`ios`, from the request), so the card first draws that platform's
 * steps and settles on the step once the browser has been read. Steps are view state: no history.
 */
type Step = "install" | "enable" | "test" | "done";

type EnableProblem = "blocked" | "brave" | "failed" | "unsupported" | "off";

const ENABLE_PROBLEM: Record<EnableProblem, string> = {
  blocked:
    "Notifications are blocked here. Allow them for MaxOff in the browser's site settings (on iPhone: Settings → Notifications → MaxOff), then try again.",
  brave:
    "Brave blocks notifications by default: Settings → Privacy and security → turn on “Use Google services for push messaging”, then try again.",
  failed:
    "This browser couldn't turn on notifications. Try again, or use Chrome, Safari or the installed app.",
  unsupported:
    "This browser can't get notifications. Open MaxOff in Chrome or Safari, or on your phone.",
  off: "Notifications aren't set up on the server yet. You can carry on: the band at the bottom will say when they are.",
};

export function OnboardingSteps({
  publicKey,
  endpoints,
  ios,
  finished,
}: {
  publicKey: string | null;
  /** The member's active endpoints, from the server. */
  endpoints: readonly string[];
  /** The request came from an iPhone or iPad (server-side, from the user agent). */
  ios: boolean;
  /** Already finished by its test (a later visit to the welcome screen). */
  finished: boolean;
}) {
  const [step, setStep] = useState<Step>(finished ? "done" : ios ? "install" : "enable");
  const [installed, setInstalled] = useState(false);
  const [problem, setProblem] = useState<EnableProblem | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(false);
  const [later, setLater] = useState(false);
  // The step has been read from this device (and the card is live): `data-ready`.
  const [ready, setReady] = useState(false);

  // The device decides the step once, on arrival, from what the server said then; afterwards the
  // steps move on by the person's own taps (the endpoints change as they do them).
  const arrival = useRef({ publicKey, endpoints, ios, finished });
  useEffect(() => {
    const { publicKey, endpoints, ios, finished } = arrival.current;
    if (finished) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async (): Promise<{ step: Step; installed: boolean; problem: EnableProblem | null }> => {
      const support = currentSupport();
      if (support.kind === "ios_not_installed") {
        return { step: "install", installed: false, problem: null };
      }
      // An iPhone that can get notifications here is running the installed app.
      const installedHere = ios;
      if (!publicKey) return { step: "enable", installed: installedHere, problem: "off" };
      if (support.kind === "unsupported") {
        return { step: "enable", installed: installedHere, problem: "unsupported" };
      }
      if (currentPermission() === "denied") {
        return { step: "enable", installed: installedHere, problem: "blocked" };
      }
      const current =
        currentPermission() === "granted" ? await browserSubscription().catch(() => null) : null;
      const onHere = current !== null && endpoints.includes(current.endpoint);
      return { step: onHere ? "test" : "enable", installed: installedHere, problem: null };
    })().then((next) => {
      if (cancelled) return;
      setStep(next.step);
      setInstalled(next.installed);
      setProblem(next.problem);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useAction(async () => {
    setProblem(null);
    const outcome = await turnOnHere(publicKey ?? "");
    if (outcome.kind === "on") setStep("test");
    else if (outcome.kind === "error") toastResult(outcome.result);
    else setProblem(outcome.kind);
  });

  const test = useAction(async () => {
    const result = await sendTestPush();
    if (!result.ok) {
      toastResult(result);
      return;
    }
    const outcome = testOutcome(result.data);
    setTested(outcome.text);
    if (!outcome.delivered) return;
    setDelivered(true);
    const finish = await finishOnboarding({ via: "test" });
    if (toastResult(finish)) setStep("done");
  });

  const skip = useAction(async () => {
    if (toastResult(await finishOnboarding({ via: "later" }))) setLater(true);
  });

  if (later) return null;

  const steps: readonly { key: Exclude<Step, "done">; title: string }[] = [
    ...(ios ? [{ key: "install" as const, title: "Install MaxOff on your iPhone" }] : []),
    { key: "enable", title: "Turn on notifications" },
    { key: "test", title: "Send a test" },
  ];
  const order: readonly Step[] = ["install", "enable", "test", "done"];
  const stateOf = (key: Step) => {
    if (key === "install" && installed) return "done";
    const diff = order.indexOf(key) - order.indexOf(step);
    return diff < 0 ? "done" : diff === 0 ? "current" : "todo";
  };

  return (
    <Card data-slot="onboarding" data-step={step} data-ready={ready ? "true" : undefined}>
      <CardHeader>
        <CardTitle>Get notifications</CardTitle>
        <CardDescription>
          {step === "done"
            ? "You're set: notifications reach you."
            : "So tasks, approvals and reminders reach you the moment they happen."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="flex flex-col gap-2">
          {steps.map((item, index) => {
            const state = stateOf(item.key);
            return (
              <li
                key={item.key}
                data-slot="onboarding-step"
                data-step={item.key}
                data-state={state}
                aria-current={state === "current" ? "step" : undefined}
                className="flex items-center gap-3 text-sm"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                    state === "current" && "border-foreground font-semibold",
                    state === "done" && "bg-foreground text-background border-foreground",
                    state === "todo" && "text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {state === "done" ? <CheckIcon className="size-3.5" /> : index + 1}
                </span>
                <span className={cn(state === "current" ? "font-medium" : "text-muted-foreground")}>
                  {item.title}
                </span>
              </li>
            );
          })}
        </ol>

        {step === "install" ? (
          <div data-slot="onboarding-install" className="flex flex-col gap-3">
            <p className="text-sm">
              iPhone notifies only the installed app. In Safari, four taps put MaxOff on your Home
              Screen; this screen comes back when you sign in there.
            </p>
            <InstallSteps />
          </div>
        ) : null}

        {step === "enable" ? (
          <div data-slot="onboarding-enable" className="flex flex-col gap-2">
            <p className="text-sm" aria-live="polite">
              {problem ? ENABLE_PROBLEM[problem] : "Your device asks once. Tap Allow when it does."}
            </p>
            {problem === "off" || problem === "unsupported" ? null : (
              <Button
                variant="primary"
                className="self-start"
                onClick={() => enable.run()}
                pending={enable.pending}
                pendingLabel="Turning on…"
                data-slot="onboarding-enable-button"
              >
                {problem ? "Try again" : "Turn on notifications"}
              </Button>
            )}
            <ActionStatus action={enable} />
          </div>
        ) : null}

        {step === "test" ? (
          <div data-slot="onboarding-test" className="flex flex-col gap-2">
            <p className="text-sm" aria-live="polite" data-slot="onboarding-test-outcome">
              {tested ?? "Send yourself a test notification to see it arrive."}
            </p>
            <Button
              variant="primary"
              className="self-start"
              onClick={() => test.run()}
              pending={test.pending}
              pendingLabel="Sending…"
              data-slot="onboarding-test-button"
            >
              {tested ? "Send another test" : "Send a test"}
            </Button>
            <ActionStatus action={test} />
          </div>
        ) : null}

        {step === "done" && delivered ? <DidItArrive /> : null}

        {step === "done" ? null : (
          <div className="flex flex-col gap-1">
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => skip.run()}
              pending={skip.pending}
              pendingLabel="Saving…"
              data-slot="onboarding-later"
            >
              Later
            </Button>
            <ActionStatus action={skip} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
