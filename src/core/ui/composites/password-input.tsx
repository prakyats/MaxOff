"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";

import { cn } from "@/core/lib/utils";
import { Input } from "@/core/ui/primitives/input";

/**
 * A password field with a show/hide toggle (task 1.5, ARCHITECTURE §14.1).
 *
 * Typing a 12-character password on a phone keyboard with no way to check it is how people end
 * up locked out, so every password field in the app gets the eye. Hidden by default: revealing
 * is a deliberate act, and the field is often filled in a room with other people in it.
 *
 * **Password managers keep working.** `autocomplete` is required rather than optional, because
 * that is the attribute managers and the browser's own autofill key off, and it must keep saying
 * `current-password` or `new-password` whichever way the toggle is set. Only `type` changes, and
 * only between `password` and `text` — the `name` and `autocomplete` never move, so a manager
 * that matched the field still matches it after a reveal.
 */
export function PasswordInput({
  autoComplete,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & {
  /** Required: this is what password managers and autofill key off. */
  autoComplete: "current-password" | "new-password";
}) {
  const [revealed, setRevealed] = useState(false);
  const Icon = revealed ? EyeOffIcon : EyeIcon;
  const label = revealed ? "Hide password" : "Show password";

  return (
    <div className="relative">
      <Input
        {...props}
        // Only `type` changes. Switching to `text` is what actually reveals it; some managers
        // stop offering to fill a field whose name or autocomplete changes, so neither does.
        type={revealed ? "text" : "password"}
        autoComplete={autoComplete}
        // Room for the button, so a long password never runs underneath it.
        className={cn("pr-12", className)}
      />
      <button
        type="button"
        // Not a submit: inside a form, a bare <button> would submit it on Enter.
        onClick={() => setRevealed((current) => !current)}
        aria-label={label}
        aria-pressed={revealed}
        title={label}
        data-slot="password-toggle"
        // 44px target per §14.1, pinned to the right edge and vertically centred. `-my-px` keeps
        // it clear of the input's own border rather than sitting on it.
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
      >
        <Icon className="size-4" aria-hidden />
      </button>
    </div>
  );
}
