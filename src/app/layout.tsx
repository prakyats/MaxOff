import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

import { cn } from "@/core/lib/utils";
import { LAUNCH_INTRO_SCRIPT, LaunchIntro } from "@/core/ui/pwa/launch-intro";
import { STANDALONE_SCRIPT } from "@/core/ui/pwa/standalone";
import launch from "@/core/ui/pwa/launch-screens.json";
import { RegisterServiceWorker } from "@/core/ui/pwa/register-service-worker";
import { THEME_COLOR_SCRIPT, THEME_COLORS } from "@/core/ui/theme/theme-color";
import { ThemeColorMeta } from "@/core/ui/theme/theme-color-meta";
import { ThemeProvider } from "@/core/ui/theme/theme-provider";

// Self-hosted at build time by next/font: no request to Google at runtime.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "MaxOff", template: "%s · MaxOff" },
  description: "Internal operations and control system for Pixora Clips",
  applicationName: "MaxOff",
  // PWA (ARCHITECTURE §14): the manifest and icons live in public/, the service worker is
  // registered by <RegisterServiceWorker /> in production builds only.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // `statusBarStyle` stays "default" on purpose (1.5, owner decision 2026-09-23):
  // "black-translucent" would let the app run under the status bar and match the background
  // exactly, but iOS then always draws the clock and battery in WHITE, which is unreadable on
  // the light background. iOS has no per-theme status bar style. **Re-check on a real iPhone
  // before the 6.6 pilot** (see PROGRESS): if "default" looks wrong installed, the fallback is
  // "black-translucent" plus a light-mode adjustment.
  appleWebApp: {
    capable: true,
    title: "MaxOff",
    statusBarStyle: "default",
    // Launch screens (2.7): without one an installed iPhone app starts on white. One per
    // current iPhone size, generated with the icons (`scripts/generate-icons.mjs`).
    startupImage: launch.screens.map(({ width, height, ratio }) => ({
      url: `/icons/startup/iphone-${width}x${height}@${ratio}.png`,
      media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
    })),
  },
};

export const viewport: Viewport = {
  // `cover` lets the Staff bottom nav extend under the iPhone home indicator (safe-area insets).
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // Both entries, straight from the page background tokens, so the chrome band is the same
  // colour as the app rather than merely close to it. These follow the OS; `ThemeColorMeta`
  // and `THEME_COLOR_SCRIPT` take over when the user picks a theme explicitly.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // next-themes sets the `dark` class before hydration, hence suppressHydrationWarning.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", geist.variable, geistMono.variable)}
    >
      <head>
        {/* Before first paint: an explicit Light/Dark choice must not flash the other band. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_COLOR_SCRIPT }} />
        {/* Every document: no zoom in the installed app where system text size applies (2.7b). */}
        <script dangerouslySetInnerHTML={{ __html: STANDALONE_SCRIPT }} />
        {/* Before first paint too: marks an installed cold start for the launch intro (2.7). */}
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_INTRO_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground min-h-dvh">
        <LaunchIntro />
        {/*
          Toaster (sonner) and TooltipProvider (radix) live in the `(app)` layout, not here.
          Nothing outside the signed-in area raises a toast or a tooltip, and mounting them
          globally put both libraries in the client bundle of /login and every auth screen
          (task 1.5: ~100 KB decompressed for a page with no toasts and no tooltips).
        */}
        <ThemeProvider>
          <ThemeColorMeta />
          {children}
        </ThemeProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
