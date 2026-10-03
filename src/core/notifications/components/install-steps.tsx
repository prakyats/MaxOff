import { PlusSquareIcon, ShareIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * "Add MaxOff to your Home Screen" on an iPhone (task 5.5, owner decision 2026-10-03, 3a; PRODUCT
 * §4.11): numbered steps, each with a small drawing of what to tap, made of the app's own icons
 * (no pictures from anywhere else). Shared by the band's sheet and a new joiner's walkthrough.
 * No state and no effects: it renders on the server too.
 */
function Picture({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="bg-muted border-border flex h-12 w-20 shrink-0 items-center justify-center rounded-lg border"
    >
      {children}
    </div>
  );
}

const STEPS: readonly { text: ReactNode; picture: ReactNode }[] = [
  {
    text: (
      <>
        In Safari, tap <strong>Share</strong> at the bottom of the screen.
      </>
    ),
    picture: (
      <Picture label="The Share button: a square with an arrow pointing up">
        <span className="bg-background ring-foreground flex size-8 items-center justify-center rounded-md ring-2">
          <ShareIcon className="text-foreground size-4" aria-hidden />
        </span>
      </Picture>
    ),
  },
  {
    text: (
      <>
        Scroll down and tap <strong>Add to Home Screen</strong>.
      </>
    ),
    picture: (
      <Picture label="The Add to Home Screen row: a square with a plus">
        <span className="bg-background ring-foreground flex items-center gap-1 rounded-md px-1.5 py-1 ring-2">
          <PlusSquareIcon className="text-foreground size-4" aria-hidden />
          <span className="h-1.5 w-6 rounded-full bg-current opacity-40" aria-hidden />
        </span>
      </Picture>
    ),
  },
  {
    text: (
      <>
        Tap <strong>Add</strong> at the top right.
      </>
    ),
    picture: (
      <Picture label="The Add button at the top right">
        <span className="flex w-14 items-center justify-between">
          <span className="h-1.5 w-5 rounded-full bg-current opacity-30" aria-hidden />
          <span className="text-foreground ring-foreground rounded px-1 text-[0.6875rem] font-semibold ring-2">
            Add
          </span>
        </span>
      </Picture>
    ),
  },
  {
    text: (
      <>
        Open <strong>MaxOff</strong> from its new icon and sign in again: the installed app keeps
        its own sign-in.
      </>
    ),
    picture: (
      <Picture label="The MaxOff icon on the Home Screen">
        <span className="bg-foreground text-background flex size-8 items-center justify-center rounded-lg text-sm font-bold">
          M
        </span>
      </Picture>
    ),
  },
];

export function InstallSteps() {
  return (
    <ol data-slot="install-steps" className="flex flex-col gap-3">
      {STEPS.map((step, index) => (
        <li key={index} className="flex items-center gap-3 text-sm">
          {step.picture}
          <span className="flex min-w-0 gap-2">
            <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
            <span className="min-w-0">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
