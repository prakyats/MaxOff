/**
 * Today's header lines (6.2, 6.3): what the page writes and its loading screen repeats, so the
 * header does not change when the page arrives (4C review S7, ARCHITECTURE §14.1). A phone shows
 * the title only.
 */
export function ownerGreeting(name: string | null | undefined): string {
  const line = "Who's in today and what needs you.";
  return name ? `Hello, ${name}. ${line}` : line;
}

export function adminGreeting(name: string | null | undefined): string {
  const line = "Your working day and the work you run.";
  return name ? `Hello, ${name}. ${line}` : line;
}
