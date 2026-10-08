/** Throwaway probe (diag/flake-dashboards-244, never merged): a timeline the spec prints. */
type DiagWindow = Window & { __diag?: { t: number; what: string; data: unknown }[] };

export function diag(what: string, data: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const w = window as DiagWindow;
  (w.__diag ??= []).push({
    t: Math.round(performance.now()),
    what,
    data: {
      ...data,
      loc: window.location.pathname,
      pending: document.documentElement.hasAttribute("data-nav-pending"),
    },
  });
}
