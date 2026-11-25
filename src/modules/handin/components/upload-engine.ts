"use client";

import type { EngineOptions, ItemState, UploadEngine } from "@/core/upload/types";

/**
 * TEMPORARY stand-in for v4.5's browser upload engine (`createUploadEngine` from `@/core/upload`,
 * #89 7162679961), which lands with the v4.5 migration. When it does, this file becomes one line:
 * `export { createUploadEngine } from "@/core/upload";`. Until then nothing is sent: every file
 * is marked failed with a plain reason, so the screens can be built and tested.
 */
export function createUploadEngine(options: EngineOptions): UploadEngine {
  const states = new Map<string, ItemState>();
  const set = (key: string, state: ItemState) => {
    states.set(key, state);
    options.onChange(key, state);
  };
  return {
    add(items) {
      for (const item of items) {
        set(item.key, {
          state: "failed",
          reason: "Uploading isn't switched on yet.",
          canRetry: false,
        });
      }
    },
    retry() {},
    pause() {},
    resume() {},
    dispose() {},
    snapshot: () => states,
  };
}
