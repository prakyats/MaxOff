// Mirrors src/core/db/health.ts (3c.1): the one probe a route may reach directly.
export function fixtureDatabaseReachable(): Promise<boolean> {
  return Promise.resolve(true);
}
