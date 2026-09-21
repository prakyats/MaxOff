"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: it replaces the root layout, so it must render <html> and <body>
 * itself and can't rely on providers. Kept dependency-free on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#fff",
          color: "#171717",
        }}
      >
        <main role="alert" style={{ textAlign: "center", maxWidth: 420 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            MaxOff couldn&apos;t load
          </h1>
          <p style={{ fontSize: 14, margin: "0 0 16px", color: "#525252" }}>
            {error.digest ? `Reference ${error.digest}. ` : ""}Try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              font: "inherit",
              fontSize: 14,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #d4d4d4",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
