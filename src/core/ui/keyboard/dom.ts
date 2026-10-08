"use client";

import { submitTarget } from "./keys";

/**
 * The browser side of the keyboard rules (ARCHITECTURE §14.3): the form's default button, a
 * submit from a key, and the first field of a dialog. The decisions are `keys.ts`'s.
 */

/** The form's default button: its first submit button in tree order, as the browser picks it. */
export function defaultSubmitter(
  form: HTMLFormElement,
): HTMLButtonElement | HTMLInputElement | null {
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLButtonElement && element.type === "submit") return element;
    if (
      element instanceof HTMLInputElement &&
      (element.type === "submit" || element.type === "image")
    ) {
      return element;
    }
  }
  return null;
}

/**
 * Submits `form` from a key, as its default button would (Ctrl+Enter in a textarea, Enter in a
 * one-line input). A destructive default button (`<Button destructive>`) is focused instead, so
 * the key never commits a destructive change by itself (rule 2). Returns what it did.
 */
export function submitFromKey(form: HTMLFormElement | null): "submit" | "focus" | "none" {
  if (!form) return "none";
  const submitter = defaultSubmitter(form);
  const target = submitTarget(submitter);
  if (target === "submit" && submitter) form.requestSubmit(submitter);
  if (target === "focus" && submitter) submitter.focus();
  return target;
}

/** The default button's label, for a hint: "Send note", "Save". Empty when there is none. */
export function submitLabel(form: HTMLFormElement | null): string {
  if (!form) return "";
  const submitter = defaultSubmitter(form);
  if (!submitter) return "";
  if (submitter instanceof HTMLInputElement) return submitter.value.trim();
  // The button's own label, not its pending twin (`data-slot="button-pending"`, only while it runs).
  const label = submitter.querySelector<HTMLElement>('[data-slot="button-label"]');
  return (label ?? submitter).textContent?.trim().replace(/\s+/g, " ") ?? "";
}

const FIELD = [
  'input:not([type="hidden"]):not([type="file"]):not([disabled]):not([readonly])',
  "textarea:not([disabled]):not([readonly])",
  "select:not([disabled])",
  '[role="combobox"]:not([disabled])',
  '[role="radio"]:not([disabled])',
  '[role="checkbox"]:not([disabled])',
].join(", ");

/** The first field a person types in or chooses from, visible and enabled; null if none. */
export function firstField(container: HTMLElement): HTMLElement | null {
  for (const element of Array.from(container.querySelectorAll<HTMLElement>(FIELD))) {
    if (element.getClientRects().length > 0) return element;
  }
  return null;
}
