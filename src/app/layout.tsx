import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

import { cn } from "@/core/lib/utils";
import { Toaster } from "@/core/ui/primitives/sonner";
import { TooltipProvider } from "@/core/ui/primitives/tooltip";
import { RegisterServiceWorker } from "@/core/ui/pwa/register-service-worker";
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
  appleWebApp: { capable: true, title: "MaxOff", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // `cover` lets the Staff bottom nav extend under the iPhone home indicator (safe-area insets).
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
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
      <body className="bg-background text-foreground min-h-dvh">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="top-center" closeButton />
        </ThemeProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
