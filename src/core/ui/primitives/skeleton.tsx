import { cn } from "cn";

/**
 * A placeholder bar. `as="span"` draws it inside text: a description `<p>`, or a text-shaped bar
 * that wraps with its words (`box-decoration-clone`), so no screen hand-types these classes
 * (v2.0 review P6, v7.0).
 */
function Skeleton({
  as: Tag = "div",
  className,
  ...props
}: React.ComponentProps<"div"> & { as?: "div" | "span" }) {
  return (
    <Tag
      data-slot="skeleton"
      // `motion-safe:` keeps the shimmer off under prefers-reduced-motion (ARCHITECTURE §14.1).
      // `max-w-full`: a bar's width is in rem, so at 200% system text a `w-20` is 160px; it never
      // grows past its box (phase 3 review: /today's tiles reached past a 375px screen). The box
      // has to be able to shrink, though: a flex or grid column with no `min-w-0` takes its
      // widest bar as its own minimum, and 100% of that is the bar (3c review: /me at 200%).
      className={cn("bg-muted max-w-full rounded-md motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
