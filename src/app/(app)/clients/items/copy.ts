/** The cross-client list's description per role: the page and its loading screen share it. */
export function itemsDescription(owner: boolean): string {
  return owner
    ? "Every client's open and done items, by Admin."
    : "The open and done items of the clients you run.";
}
