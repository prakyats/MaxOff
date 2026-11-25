/**
 * Sizes as people read storage (v4.0 Drive, v4.5 uploads): decimal units, like Google's own "2 TB".
 * Pure and dependency-free, for server and browser alike: "5.4 GB", "640 MB", "312 bytes".
 */
export function sizeWords(value: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"] as const;
  let size = value;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(size)} bytes`;
  const rounded = size >= 100 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
