"use client";

import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useSyncExternalStore } from "react";

import { cn } from "@/core/lib/utils";
import { NAV_BACK } from "@/core/ui/motion/nav-types";
import { nameSlide, slideBack } from "@/core/ui/motion/slide";
import { BACK_FROM_ATTRIBUTE, markLive } from "@/core/ui/navigation/attributes";
import { entryPaths, subscribeEntries } from "@/core/ui/navigation/entries";
import { backSteps, originMatches } from "@/core/ui/navigation/moves";
import { whenOnPageEntry } from "@/core/ui/overlay/overlay-history";

/**
 * Another screen a drill-down screen is opened from besides its parent (a task from the
 * calendar): back returns there, and the control names it. `path` is a pathname, or a prefix
 * written `/reports/end-of-day/*`.
 */
export interface BackOrigin {
  path: string;
  label: string;
}

const NO_ORIGINS: readonly BackOrigin[] = [];

function pathnameOf(href: string): string {
  return new URL(href, "http://x").pathname;
}

/**
 * The page one tap lands on, by `backSteps`: the label of the origin it is when it is one, else
 * the parent's own label (the parent, an ancestor of it, or the replace).
 */
function landingLabel(parent: string, label: string, from: readonly BackOrigin[]): string {
  if (from.length === 0) return label;
  const paths = entryPaths();
  const steps = backSteps(
    paths,
    parent,
    from.map((origin) => origin.path),
  );
  if (!paths || steps === 0) return label;
  const target = paths[paths.length - 1 - steps] ?? "";
  if (target === parent || parent.startsWith(`${target}/`)) return label;
  return from.find((origin) => originMatches(origin.path, target))?.label ?? label;
}

/**
 * The back control in a drill-down screen's header (`PageHeader` `back`, ARCHITECTURE §14.2 k).
 * A real link to the parent, so it opens in a new tab like one; a plain tap is answered by
 * `backSteps()` (`navigation/moves.ts`), before hydration too (`navigation/pre-hydration.ts`):
 *
 * - the previous page is the parent, an ancestor of it or one of `from`: **back** to it, over
 *   this screen's own entries beneath (an overlay's spent entry), never adding a step;
 * - anything else (opened directly, from a notification, no Navigation API): **replace** with
 *   the parent, once any spent overlay entry on top has been backed out (`whenOnPageEntry`).
 *
 * Either way one tap moves (2026-10-15: a tap that went back one entry onto a spent sheet's entry
 * of the same page did nothing). **An installed iOS app has no system back gesture**, so every
 * drill-down screen carries one. `variant`: the phone's chevron in the title bar, or the desktop's
 * text link above the title; the label follows the page the tap will land on.
 */
export function BackLink({
  href,
  label,
  from = NO_ORIGINS,
  variant,
  labelWidth,
  className,
}: {
  href: string;
  label: string;
  from?: readonly BackOrigin[] | undefined;
  variant: "icon" | "text";
  /** A loading screen's parent whose name is not read yet: a bar of this width for the label. */
  labelWidth?: string | undefined;
  className?: string;
}) {
  const router = useRouter();
  const parent = pathnameOf(href);
  const shown = useSyncExternalStore(
    subscribeEntries,
    () => landingLabel(parent, label, from),
    () => label,
  );
  return (
    <Link
      href={href}
      data-slot="page-back"
      {...(from.length > 0
        ? { [BACK_FROM_ATTRIBUTE]: from.map((origin) => origin.path).join(" ") }
        : {})}
      aria-label={variant === "icon" ? `Back to ${shown}` : undefined}
      className={cn("pressable", className)}
      ref={markLive}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        const steps = backSteps(
          entryPaths(),
          parent,
          from.map((origin) => origin.path),
        );
        // Both moves slide back out in the installed app (§14.2 j): the back through
        // `slideBack`, since a history move carries no type; the replace through its transition
        // type and the slide's name (`nameSlide`: the type alone is lost when the tap lands while
        // the screen is still hydrating).
        if (steps > 0) {
          slideBack(() => window.history.go(-steps));
          return;
        }
        const replace = () => {
          nameSlide("back");
          router.replace(href, { transitionTypes: [NAV_BACK] });
        };
        // On a spent overlay entry, the page's own entry first: a replace there would leave this
        // screen beneath its parent. Out of the last popstate's dispatch, so Next's restore of
        // the entry comes first (as the calendar's filters do).
        let now = true;
        whenOnPageEntry(() => (now ? replace() : window.setTimeout(replace, 0)));
        now = false;
      }}
    >
      {variant === "icon" ? (
        <ChevronLeftIcon className="size-5" aria-hidden />
      ) : (
        <>
          <ChevronLeftIcon className="size-4" aria-hidden />
          {labelWidth ? (
            // The bar in a line box of the label's own height (`text-sm`, 20px): a bare 14px bar
            // made the link 16px high, and the title beside it sat 4px high until the page came.
            <span aria-hidden className="inline-flex h-5 items-center">
              <span
                className={cn(
                  "bg-muted inline-block h-3.5 rounded-md motion-safe:animate-pulse",
                  labelWidth,
                )}
              />
            </span>
          ) : (
            shown
          )}
        </>
      )}
    </Link>
  );
}
