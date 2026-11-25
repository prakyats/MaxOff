import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";

import "../(main)/globals.css";

import { cn } from "@/core/lib/utils";
import { THEME_COLORS } from "@/core/ui/theme/theme-color";

// Self-hosted at build time by next/font, as in the app (no request to Google at runtime).
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "Send files", template: "%s" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

/** The system's theme before the first paint (the app's own theme choice is not here). */
const THEME = `(function(){try{if(matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.classList.add("dark");}catch(e){}})();`;

/**
 * The upload page's own root layout (v4.5, plan J): `/upload` is outside the app, so none of the
 * app's shell is here: no navigation, no service-worker registration, no manifest, no theme
 * provider, no Toaster. Its only inline script carries this request's nonce (the proxy's J1 CSP),
 * and the rest is Next's own scripts, which Next nonces itself.
 */
export default async function UploadRootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={cn("antialiased", geist.variable)}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body className="bg-background text-foreground min-h-dvh">{children}</body>
    </html>
  );
}
