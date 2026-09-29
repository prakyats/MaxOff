"use client";

import { Loader2Icon } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { cn } from "cn";
import { Slot } from "radix-ui";

import { OFFLINE_BANNER_ID, useOnline } from "@/core/ui/connection/online";

import { buttonVariants, type ButtonVariantProps } from "./button-variants";

/**
 * The one button (colour rule and variants: `button-variants.ts`). On top of the look, every
 * button carries MaxOff's tap rules (ARCHITECTURE §14.1, owner 2026-09-28):
 *
 * - **pressed** within a frame (`pressable`, CSS, before hydration too);
 * - **pending**: pass `pending` (from `useAction`, or a form's transition) and it swaps to a
 *   small spinner and `pendingLabel` ("Saving…", "Approving…"), `disabled` and `aria-busy`, so
 *   a second tap does nothing. Both labels share one grid cell, so the button never changes
 *   width. A submit button inside a `<form action>` goes pending on its own (`useFormStatus`);
 * - **offline**: a button that commits a change (`primary` by default, or `commits`) is disabled
 *   while the device is offline, pointing at the offline banner for the reason.
 *
 * `pending-buttons.test.ts` sweeps for a commit button without `pending`.
 */
function Button({
  className,
  variant = "secondary",
  size = "default",
  asChild = false,
  pending: pendingProp,
  pendingLabel,
  commits,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  ButtonVariantProps & {
    asChild?: boolean;
    /** The action this button started is on its way. */
    pending?: boolean;
    /** What it says while pending: "Saving…", "Starting…". Defaults to its label. */
    pendingLabel?: React.ReactNode;
    /** It commits a change, so it waits for a connection. `primary` buttons do by default. */
    commits?: boolean;
  }) {
  const form = useFormStatus();
  const online = useOnline();
  const submits = !asChild && (props.type ?? "submit") === "submit";
  // Only a button that takes part (`pending` passed, even false) swaps its label; any other
  // submit still disables itself while its `<form action>` is on its way.
  const opted = pendingProp !== undefined;
  const pending = (pendingProp ?? false) || (submits && form.pending);
  const offline = !online && (commits ?? variant === "primary");
  const iconOnly = typeof size === "string" && size.startsWith("icon");

  const content =
    asChild || !opted ? (
      children
    ) : iconOnly ? (
      pending ? (
        <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden />
      ) : (
        children
      )
    ) : (
      <span
        // The cell also holds the working label's width, as an invisible pseudo-element (not
        // text, so the button's text and accessible name stay its label): the button keeps its
        // width when it switches.
        data-pending-label={pendingLabel}
        className={cn(
          "grid items-center justify-items-center [grid-template-areas:'label'] *:[grid-area:label]",
          pendingLabel !== undefined &&
            "after:invisible after:pl-[1.375rem] after:content-[attr(data-pending-label)] after:[grid-area:label]",
        )}
      >
        <span
          className={cn("inline-flex items-center gap-1.5", pending && "invisible")}
          aria-hidden={pending || undefined}
        >
          {children}
        </span>
        {pending ? (
          <span data-slot="button-pending" className="inline-flex items-center gap-1.5">
            <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden />
            {pendingLabel ?? children}
          </span>
        ) : null}
      </span>
    );

  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-pending={pending ? "" : undefined}
      data-offline={offline ? "" : undefined}
      aria-busy={pending || undefined}
      disabled={asChild ? disabled : disabled || pending || offline}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      {...(offline ? { "aria-describedby": OFFLINE_BANNER_ID } : {})}
    >
      {content}
    </Comp>
  );
}

export { Button, buttonVariants };
