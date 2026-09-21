/**
 * The `/dev/ui` gallery exists only outside production. Pure so `enabled.test.ts` can
 * prove it. DEVELOPMENT-ONLY: task 1.2 deletes this folder along with the preview-role shim.
 */
export function isDevGalleryEnabled(nodeEnv: string | undefined): boolean {
  // Allow-list: an unset or unusual NODE_ENV never enables it.
  return nodeEnv === "development" || nodeEnv === "test";
}
