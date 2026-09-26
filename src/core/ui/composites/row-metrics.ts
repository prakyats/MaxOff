/**
 * Row geometry shared between real content and the skeleton that stands in for it
 * (ARCHITECTURE §14.1: "skeletons trace their own screen").
 *
 * These exist so a card and its loading placeholder cannot drift apart. If a card's height
 * changes here, the skeleton changes with it; `loading-state.test.tsx` fails if either side
 * stops using the constant.
 */

/** Height of one mobile card row in `DataTable`, and of one `shape="cards"` skeleton row. */
export const CARD_ROW_MIN_H = "min-h-16";

/** Horizontal and vertical padding inside a mobile card row. */
export const CARD_ROW_PADDING = "px-4 py-3";

/**
 * Large system text (§14.2 i, 2.7b): a card row wraps instead of squeezing its title to nothing.
 * The row is `flex-wrap`; the title keeps at least 6rem (rem, so it grows with the text), and
 * once the trailing part no longer fits beside it, that part moves to a second line, right-aligned.
 * At the default text size every row stays on one line, so the skeletons still trace it.
 */
export const CARD_ROW_TITLE = "min-w-0 flex-[1_1_6rem]";
export const CARD_ROW_TRAILING = "ml-auto shrink-0";

/** Height of one settings / grouped-list row. */
export const LIST_ROW_MIN_H = "min-h-11";
