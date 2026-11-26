/**
 * Me → Privacy's header (v7.5 Q1), shared by the page and its loading screen so nothing moves when
 * the page arrives (ARCHITECTURE §14.1). Its parent is Me; the home screen's card opens it too, and
 * back then returns there (the browser's own back: the card is a link).
 */
export const PRIVACY_HEADER = {
  title: "Privacy",
  description: "What MaxOff keeps about you, who can see it, and for how long.",
  back: { href: "/me", label: "Me" },
} as const;
