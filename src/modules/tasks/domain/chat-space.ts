/**
 * The laptop task page's chat space (v1.8, owner-approved 23 Oct: "task chat height", the sample
 * `docs/design/v18-task-chat-height-sample.html`, laptop only; a phone is unchanged). Pure rules,
 * so the measuring code in `task-chat.tsx` and `task-view.tsx` stays thin and these are tested.
 */

/** What the panel's measure reads from the screen, in CSS pixels. */
export type ChatSpaceInput = {
  /** The window's inner height. */
  viewport: number;
  /** Where the panel starts now, from the window's top (it rises as the page scrolls). */
  panelTop: number;
  /**
   * Where the panel starts once the Work | Chat bar is stuck: the top bar, the bar and the gap
   * under it. The panel never starts higher than this.
   */
  stuckTop: number;
  /** The bands fixed at the screen's foot (offline, notifications off). */
  bands: number;
  /** The page's own foot padding under the panel. */
  foot: number;
  /** The panel is never shorter than this (a short screen scrolls the page instead). */
  min: number;
};

/**
 * The panel's height now and the room the page keeps for it.
 *
 * - **panel:** from where the panel starts to the screen's foot, so the composer is always pinned
 *   in view: on opening (the header above it), and taller as the page scrolls and the header goes.
 * - **reserve:** the panel's height once the bar is stuck (the most it grows to). The page keeps
 *   that much room under the bar, so it can scroll exactly until the bar sticks and no further.
 */
export function chatSpace(input: ChatSpaceInput): { panel: number; reserve: number } {
  const room = (top: number) => Math.floor(input.viewport - top - input.bands - input.foot);
  const reserve = Math.max(input.min, room(input.stuckTop));
  const panel = Math.min(
    reserve,
    Math.max(input.min, room(Math.max(input.panelTop, input.stuckTop))),
  );
  return { panel, reserve };
}

/**
 * Whether the Work | Chat bar is stuck under the top bar: its top has reached where it sticks
 * (half a pixel of rounding allowed) and the page has scrolled. On opening it never is.
 */
export function barStuck(barTop: number, stickAt: number, scrollY: number): boolean {
  return scrollY > 0 && barTop <= stickAt + 0.5;
}

/** A person on the task, for the chat's lines: their name ("You" for the reader) and Task Noted. */
export type ChatSpacePerson = { name: string; noted: boolean; self: boolean };

/**
 * The People card's key line, kept in the chat's head once the card has scrolled away with the
 * header (the sample's "PShetty · Noted"): one person, "Noted" or "Not noted"; several, "All
 * noted" or "1 of 2 noted". Nobody on the task: nothing.
 */
export function notedLine(people: readonly ChatSpacePerson[]): string | null {
  if (people.length === 0) return null;
  const noted = people.filter((person) => person.noted).length;
  if (people.length === 1) return noted === 1 ? "Noted" : "Not noted";
  return noted === people.length ? "All noted" : `${noted} of ${people.length} noted`;
}

/**
 * The enlarged chat's title (the sample's "Edit · chat with PShetty"): the task's title and the
 * others on it by their first names, up to three then "+n"; only the reader on it, "Chat".
 */
export function enlargedTitle(title: string, people: readonly ChatSpacePerson[]): string {
  const others = people.filter((person) => !person.self).map((person) => firstName(person.name));
  if (others.length === 0) return `${title} · Chat`;
  const shown = others.slice(0, 3).join(", ");
  const more = others.length > 3 ? ` +${others.length - 3}` : "";
  return `${title} · chat with ${shown}${more}`;
}

/**
 * The enlarged chat's second line (the sample's "In progress · Overdue 4 days"): the state's
 * words and, while the task is open, the deadline relative to now, capitalised.
 */
export function enlargedLine(state: string, relative: string | null): string {
  if (!relative) return state;
  return `${state} · ${relative.charAt(0).toUpperCase()}${relative.slice(1)}`;
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}
