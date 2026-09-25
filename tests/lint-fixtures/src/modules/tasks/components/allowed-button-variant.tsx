import type { ReactNode } from "react";

/** Stands in for the primitive: the rule reads the JSX, not the import. */
function Button(props: { variant?: string; className?: string; children?: ReactNode }) {
  return <button type="button">{props.children}</button>;
}

export const Right = () => (
  <Button variant="primary" className="w-full justify-start">
    Save
  </Button>
);
