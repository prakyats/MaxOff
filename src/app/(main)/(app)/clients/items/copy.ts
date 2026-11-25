/** The cross-client list's description per role: the page and its loading screen share it. */
export function itemsDescription(owner: boolean): string {
  return owner
    ? "Every client's open deliverables, by Admin."
    : "The open deliverables of the clients you run.";
}
