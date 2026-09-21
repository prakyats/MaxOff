import Link from "next/link";

import { cn } from "@/core/lib/utils";

/** The MaxOff wordmark, linking to the viewer's home. */
export function Brand({ href, className }: { href: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "focus-visible:ring-ring flex items-center gap-2 rounded-md outline-none focus-visible:ring-2",
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-logo flex size-7 items-center justify-center rounded-md text-xs font-bold text-white"
      >
        M
      </span>
      <span className="text-sm font-semibold tracking-tight">MaxOff</span>
    </Link>
  );
}
