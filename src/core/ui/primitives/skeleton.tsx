import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // `motion-safe:` keeps the shimmer off under prefers-reduced-motion (ARCHITECTURE §14.1).
      // `max-w-full`: a bar's width is in rem, so at 200% system text a `w-20` is 160px; it never
      // grows past its box (phase 3 review: /today's tiles reached past a 375px screen).
      className={cn("bg-muted max-w-full rounded-md motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
