"use client";

import { FileImage } from "@/core/storage/components/file-image";
import { cn } from "@/core/lib/utils";

/**
 * A client's logo as lists and headers show it (PRODUCT §4.4: "the logo shows in client lists"):
 * the browser-made preview through the permission-checked route (`FileImage`), or the name's
 * first letters on a neutral tile when there is none. Decorative: the name is always beside it.
 */
export function ClientLogo({
  fileId,
  name,
  size = "sm",
  className,
}: {
  fileId: string | null;
  name: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const box = size === "lg" ? "size-16 rounded-xl" : "size-8 rounded-md";
  if (fileId) {
    return (
      <FileImage
        fileId={fileId}
        alt=""
        className={cn(box, "border-border bg-background shrink-0 border p-0.5", className)}
      />
    );
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden
      data-slot="client-logo-fallback"
      className={cn(
        box,
        "bg-muted text-muted-foreground flex shrink-0 items-center justify-center font-medium",
        size === "lg" ? "text-lg" : "text-xs",
        className,
      )}
    >
      {initials}
    </span>
  );
}
