import { notFound } from "next/navigation";

/**
 * Any URL no route matches. Since v4.5 the app has two root layouts (`(main)` and `(upload)`), so
 * Next has no single root to put its own 404 in and would answer with its bare default page. This
 * catch-all (the lowest-priority match, so it never shadows a real route) hands such URLs to
 * `(main)/not-found.tsx` inside `(main)`'s root layout: the same page as before the split. No data.
 */
export default function Missing(): never {
  notFound();
}
