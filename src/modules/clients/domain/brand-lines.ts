import type { BrandColor, BrandFont } from "./schemas";

/**
 * Brand colours and fonts as the edit pattern types them (3.4): one per line, so the brand is
 * edited with the same `EditableRecord` textarea as every other record rather than a bespoke
 * list editor. A colour line is "Name #RRGGBB" (a colon or dash between is fine; a bare hex names
 * itself); a font line is "Family: usage" (the usage is optional). Pure, so the rules are unit
 * tested; the action parses again on the server.
 */

export type Parsed<T> = { ok: true; value: T[] } | { ok: false; error: string };

const HEX = /#([0-9a-fA-F]{6})\b/;

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function colorLines(colors: readonly BrandColor[]): string {
  return colors.map((color) => `${color.name} ${color.hex}`).join("\n");
}

export function parseColorLines(text: string, max: number): Parsed<{ name: string; hex: string }> {
  const value: { name: string; hex: string }[] = [];
  for (const line of lines(text)) {
    const match = HEX.exec(line);
    if (!match) {
      return { ok: false, error: `"${line}" has no colour: add a hex value like #E11D48.` };
    }
    const hex = `#${(match[1] ?? "").toUpperCase()}`;
    const name = line
      .replace(match[0], "")
      .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
      .trim();
    value.push({ name: name || hex, hex });
  }
  if (value.length > max) return { ok: false, error: `Up to ${max} colours.` };
  return { ok: true, value };
}

export function fontLines(fonts: readonly BrandFont[]): string {
  return fonts
    .map((font) => (font.usage ? `${font.family}: ${font.usage}` : font.family))
    .join("\n");
}

export function parseFontLines(
  text: string,
  max: number,
): Parsed<{ family: string; usage?: string }> {
  const value: { family: string; usage?: string }[] = [];
  for (const line of lines(text)) {
    const at = line.indexOf(":");
    const family = (at === -1 ? line : line.slice(0, at)).trim();
    const usage = at === -1 ? "" : line.slice(at + 1).trim();
    if (!family) return { ok: false, error: `"${line}" has no font name before the colon.` };
    value.push(usage ? { family, usage } : { family });
  }
  if (value.length > max) return { ok: false, error: `Up to ${max} fonts.` };
  return { ok: true, value };
}
