import { XMLBuilder, XMLParser } from "fast-xml-parser";

/**
 * SVG sanitising on upload completion (ARCHITECTURE §11, kickoff 3 decision 11). A logo may be
 * an SVG, and an SVG is a document: it can carry scripts, event handlers, external references
 * and foreign markup. The file is parsed into a tree and rebuilt from an **allow-list** of
 * elements and attributes; anything not listed is dropped, never "escaped".
 *
 * Why a strict allow-list parser and not DOMPurify: DOMPurify needs a DOM, which means jsdom
 * on the server (several megabytes, and not something the Workers runtime runs), while
 * `fast-xml-parser` is small, pure JavaScript, keeps element order and attributes
 * (`preserveOrder`) and runs anywhere `fetch` does. The trade is that this list is ours to
 * keep: an SVG feature not named here is removed, which for a logo is the right default.
 *
 * The sanitised file is what the bucket keeps; previews are made in the browser from the
 * original before upload, so nothing here ever renders. Served only through `<img>` (never
 * inline), with a CSP that forbids scripts and external loads on top of this pass.
 */

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "metadata",
  "switch",
]);

/** Attributes that may reference something: only a same-document `#id` survives. */
const REFERENCE_ATTRIBUTES = new Set(["href", "xlink:href"]);

const DROPPED_ATTRIBUTES = new Set([
  "xlink:actuate",
  "xlink:show",
  "externalResourcesRequired",
  "contentScriptType",
  "onload",
]);

/** `url(...)` in a style or paint may reach out of the document; only `url(#id)` stays. */
const EXTERNAL_URL = /url\s*\(\s*['"]?\s*(?!#)/i;
const DANGEROUS_STYLE = /(expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding)/i;

type Node = Record<string, unknown>;

function attributesOf(node: Node): Record<string, string> | undefined {
  const attrs = node[":@"];
  return attrs && typeof attrs === "object" ? (attrs as Record<string, string>) : undefined;
}

function nameOf(node: Node): string | undefined {
  return Object.keys(node).find((key) => key !== ":@");
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * Namespace declarations: only the SVG default and the XLink prefix under its usual name
 * survive. Any other `xmlns:*` could alias XLink (`xmlns:f` + `f:href`) or bring in a foreign
 * vocabulary, so it goes, and an attribute under a prefix it declared no longer resolves.
 */
function keepsNamespace(name: string, value: string): boolean {
  if (name === "xmlns") return value.trim() === SVG_NS;
  if (name === "xmlns:xlink") return value.trim() === XLINK_NS;
  return false;
}

function cleanAttributes(attrs: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, raw] of Object.entries(attrs)) {
    const value = String(raw);
    const lower = name.toLowerCase();
    const localName = lower.slice(lower.lastIndexOf(":") + 1);
    if (lower.startsWith("on") || DROPPED_ATTRIBUTES.has(name)) continue;
    if (lower === "xmlns" || lower.startsWith("xmlns:")) {
      if (keepsNamespace(name, value)) kept[name] = value.trim();
      continue;
    }
    // A CSS escape (`\75rl(`) hides `url(` from the tests below, in a style and in a
    // presentation attribute alike; nothing a logo needs carries a backslash.
    if (value.includes("\\")) continue;
    if (localName === "href") {
      // Any prefix bound to XLink is still a link: only the two usual spellings are kept.
      if (!REFERENCE_ATTRIBUTES.has(name)) continue;
      if (!value.trim().startsWith("#")) continue;
      kept[name] = value.trim();
      continue;
    }
    if (lower === "style" && (EXTERNAL_URL.test(value) || DANGEROUS_STYLE.test(value))) continue;
    if (EXTERNAL_URL.test(value)) continue;
    if (/^\s*(javascript|data|vbscript):/i.test(value)) continue;
    kept[name] = value;
  }
  return kept;
}

function cleanNodes(nodes: unknown, depth: number): Node[] {
  if (!Array.isArray(nodes) || depth > 64) return [];
  const out: Node[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Node;
    const name = nameOf(record);
    if (!name) continue;
    if (name === "#text") {
      out.push(record);
      continue;
    }
    if (!ALLOWED_ELEMENTS.has(name)) continue; // comments, PIs, script, foreignObject, image, a, style…
    const attrs = attributesOf(record);
    const cleaned: Node = { [name]: cleanNodes(record[name], depth + 1) };
    if (attrs) {
      const keptAttrs = cleanAttributes(attrs);
      if (Object.keys(keptAttrs).length > 0) cleaned[":@"] = keptAttrs;
    }
    out.push(cleaned);
  }
  return out;
}

export class SvgSanitiseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SvgSanitiseError";
  }
}

/**
 * Returns the sanitised document, or throws `SvgSanitiseError` when the input is not an SVG
 * document at all (not XML, or its root is not `<svg>`).
 */
export function sanitiseSvg(source: string): string {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    allowBooleanAttributes: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    // Entities are decoded on the way in, so the checks see what a renderer would (`&#117;rl(`
    // is `url(`), and the builder escapes each character exactly once on the way out (parsing
    // them raw and escaping on build turned `&amp;` into `&amp;amp;`). The DOCTYPE, with any
    // internal subset, is removed first, so no declared entity is ever expanded.
    processEntities: true,
    htmlEntities: true, // also decodes numeric references (`&#117;`, `&#x75;`)
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  });
  let tree: unknown;
  try {
    tree = parser.parse(source.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/i, ""));
  } catch (error) {
    throw new SvgSanitiseError(
      `Not a well-formed SVG: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const roots = cleanNodes(tree, 0).filter((node) => nameOf(node) === "svg");
  if (roots.length !== 1) throw new SvgSanitiseError("Not an SVG document (no single <svg> root).");
  const root = roots[0] as Node;
  const attrs = { xmlns: SVG_NS, ...(attributesOf(root) ?? {}) };
  root[":@"] = attrs;

  const builder = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    suppressEmptyNode: true,
    format: false,
    processEntities: true,
  });
  return builder.build([root]) as string;
}
