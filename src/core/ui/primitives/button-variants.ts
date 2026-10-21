import { cva, type VariantProps } from "class-variance-authority";

/**
 * The action colour rule (ADR-0015, docs/DESIGN.md §4): red is urgent or destructive only. Six
 * variants, no others:
 *
 * - `primary`: neutral solid, **the one action that commits a change** (Save, Send, Create,
 *   Approve, Mark done). At most one visible per layer: screen, dialog, sheet or floating sticky
 *   bar (checked by the e2e fixture). Disabled is muted, not faded.
 * - `danger`: solid red, **the commit of a destructive action**, named for it ("Discard changes",
 *   "Remove Diwali", "Reject claim"), inside its confirmation only. It counts as the layer's one
 *   commit. `ConfirmDialog` / `ReasonDialog` choose it when told the act is `destructive`.
 * - `destructive`: red outline and red text, a destructive action **before** its confirmation.
 * - `secondary`: neutral outline (`--control-border`, ≥ 3:1): Cancel, Keep editing, Review, Edit.
 * - `ghost`: icon and utility buttons.
 * - `strong`: neutral solid (black in light, white in dark): a trigger that opens a form or a
 *   confirmation where the commit happens (a FAB, the Approvals row Approve and Approve all).
 *
 * Colour classes on buttons outside `core/ui/primitives` are a lint error.
 */
export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap pressable outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground",
        danger:
          "bg-destructive-solid text-destructive-solid-foreground hover:bg-destructive-solid/90 disabled:bg-muted disabled:text-muted-foreground",
        strong:
          "bg-strong text-strong-foreground hover:bg-strong/85 disabled:bg-muted disabled:text-muted-foreground",
        secondary:
          "border-control-border text-foreground hover:bg-muted aria-expanded:bg-muted disabled:opacity-50",
        destructive:
          "border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 disabled:opacity-50",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
