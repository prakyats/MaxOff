import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MaxOff",
  description: "Internal operations and control system for Pixora Clips",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
