import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // `motion-safe:` keeps the shimmer off under prefers-reduced-motion (ARCHITECTURE §14.1).
      className={cn("bg-muted rounded-md motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
