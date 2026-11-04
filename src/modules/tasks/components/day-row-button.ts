/**
 * The look of a calendar day's pinned action row (v1.9 W5, the approved sample's "+ New task on
 * Fri 30 Oct" at the foot of a day), shared by "+ New task on ‹day›" and Crew's "Suggest a task on
 * ‹day›": the whole row is the button, under a dashed line, quiet (a trigger that opens a form, never
 * a second solid on the layer), its words left-aligned, a 44 px target; never scrolled away (it
 * does not shrink in its column). No action (a past day, today from 11:59 pm IST): no row. Its own module, so a screen with only "Suggest
 * a task" (My Day) never loads the New task button with it.
 */
export const DAY_ROW_BUTTON =
  "border-border h-auto min-h-11 w-full shrink-0 justify-start rounded-none border-t border-dashed px-4 text-sm font-medium";
