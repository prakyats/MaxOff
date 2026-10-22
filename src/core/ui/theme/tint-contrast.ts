/**
 * Contrast arithmetic for the light-theme chip audit (PP-light-3, V5b): WCAG relative luminance,
 * the contrast ratio, and a translucent tint composited over its surface (`bg-x/10`,
 * `color-mix(… 15%, transparent)`), so a test can check text on a tint as the screen draws it.
 */
export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRgb(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `color` at `alpha` over the opaque `surface`. */
export function over(color: Rgb, alpha: number, surface: Rgb): Rgb {
  return color.map((value, index) => value * alpha + (surface[index] ?? 0) * (1 - alpha)) as Rgb;
}

/** Reads a CSS block (`:root { ... }` or `.dark { ... }`) into a var → hex map. */
export function readTokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("\n}", start);
  const tokens: Record<string, string> = {};
  for (const match of css.slice(start, end).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1] as string] = match[2] as string;
  }
  return tokens;
}
