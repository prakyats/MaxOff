/**
 * `bytea` over PostgREST: sent and received as Postgres' hex text, `\x` then two hex digits a
 * byte. Hashes and salts only (never a token), so nothing here is a secret by itself.
 */
export function toBytea(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `\\x${hex}`;
}

export function fromBytea(text: string): Uint8Array {
  const hex = text.startsWith("\\x") ? text.slice(2) : text;
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("Not a bytea hex value");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
