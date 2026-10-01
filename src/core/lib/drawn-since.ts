/**
 * Whether a screen drawn by the server is shown again after something changed on this device
 * (ARCHITECTURE §14.2: back and forward restore a screen from the router's history cache, never
 * from the server). Every change bumps a version; each drawing (`renderId`, one per server
 * render) remembers the version it first met and is stale when shown again after a change.
 * Module state of the caller: one page's lifetime, no storage.
 */
export interface DrawnSince {
  /** Something the screens show changed on this device. */
  changed(): void;
  /** Whether the drawing `renderId` is shown after a change it never met (then fresh again). */
  staleSinceDrawn(renderId: string): boolean;
}

export function drawnSince(): DrawnSince {
  let version = 0;
  const seen = new Map<string, number>();
  return {
    changed() {
      version += 1;
    },
    staleSinceDrawn(renderId) {
      const first = seen.get(renderId);
      if (first === undefined) {
        seen.set(renderId, version);
        return false;
      }
      if (first === version) return false;
      seen.set(renderId, version);
      return true;
    },
  };
}
