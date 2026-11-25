/**
 * The upload page's layout (v4.5, plan J). **For now a pass-through**: the page renders inside
 * today's root layout until the `(main)` move (PROGRESS, advisor 25 Nov 2026). The move is one
 * pure rename commit; the commit after it turns this into the page's own root layout (html, body,
 * fonts, globals.css only: no app shell, no service-worker registration, no manifest) and starts
 * the nonce CSP (J1). Nothing here, or in the page, adds an inline or third-party script.
 */
export default function UploadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
