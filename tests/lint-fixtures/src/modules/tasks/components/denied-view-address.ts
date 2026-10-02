export function chooseView(view: string): void {
  window.history.replaceState(null, "", `?tab=${view}`);
}
