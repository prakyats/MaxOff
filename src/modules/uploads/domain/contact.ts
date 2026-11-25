/**
 * Who an uploader writes to about their details (Q14, owner 19 Nov 2026): MaxOff's own mail
 * address, the one it sends from (`EMAIL_FROM`, "MaxOff <studio@example.com>"), never a personal
 * one. The address alone, or null where none is configured (local `noreply@localhost`).
 */
export function uploaderContact(from: string | undefined): string | null {
  const text = from?.trim() ?? "";
  const address = (/<([^<>\s]+@[^<>\s]+)>/.exec(text)?.[1] ?? text).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  return address;
}
