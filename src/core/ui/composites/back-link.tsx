"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";

/**
 * What the on-screen back control does (ARCHITECTURE §14.2 k): with an entry of this app beneath
 * the current one it goes back to it (no new entry); a page opened directly (a deep link, a new
 * window, the first page after a restart) has nothing of ours beneath, so it goes to its parent
 * and **replaces** itself, never leaving the app and never adding a step.
 *
 * `index` is the Navigation API's `currentEntry.index`, which counts this origin's entries only.
 * Without the API (an older browser) the answer is the parent: the safe one, since it can never
 * leave the app.
 */
export function backMove(index: number | undefined): "back" | "parent" {
  return index !== undefined && index > 0 ? "back" : "parent";
}

type NavigationLike = { currentEntry?: { index: number } | null };

function currentIndex(): number | undefined {
  const navigation = (window as { navigation?: NavigationLike }).navigation;
  return navigation?.currentEntry?.index;
}

/**
 * The back control in a drill-down screen's header (`PageHeader` `back`). A real link to the
 * parent, so it works before hydration and opens in a new tab like one; a plain tap is handled
 * by `backMove()`. **An installed iOS app has no system back gesture**, so every drill-down
 * screen carries one (§14.2 k).
 */
export function BackLink({
  href,
  onClick,
  ...props
}: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      data-slot="page-back"
      {...props}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        if (backMove(currentIndex()) === "back") router.back();
        else router.replace(href);
      }}
    />
  );
}
