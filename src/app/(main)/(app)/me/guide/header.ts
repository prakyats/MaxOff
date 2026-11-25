import type { BackOrigin } from "@/core/ui/composites/back-link";

/**
 * The guide's header, shared by the page and its loading screen so nothing moves when the page
 * arrives (ARCHITECTURE §14.1). Its parent is Me (where "How MaxOff works" sits for everyone);
 * Settings is the other screen it is opened from (Help and troubleshooting), so back returns
 * there when that is the page beneath.
 */
const FROM: readonly BackOrigin[] = [{ path: "/settings", label: "Settings" }];

export const GUIDE_HEADER = {
  title: "How MaxOff works",
  description: "Only what your role can see and do, in the order you meet it.",
  back: { href: "/me", label: "Me", from: FROM },
} as const;
