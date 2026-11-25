import { NotFound } from "@/core/ui/composites/not-found";

/** 404 for any route outside the app shell (inside it, `(app)/not-found.tsx` keeps the chrome). */
export default function RootNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center p-6">
      <NotFound />
    </main>
  );
}
