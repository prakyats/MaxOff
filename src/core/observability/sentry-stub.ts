/**
 * EXPERIMENT ONLY (unit P, 2026-10-15; branch exp/p-no-sentry, never merged): `@sentry/nextjs`
 * aliased to this no-op so a preview build can be probed without the Node SDK in the Worker,
 * to measure the SDK's share of the cold start. Nothing is reported anywhere on this build.
 */
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
export function init(_options?: unknown): void {}
export function setTag(_key: string, _value: unknown): void {}
export function setExtra(_key: string, _value: unknown): void {}
export function setContext(_name: string, _context: unknown): void {}
export function setUser(_user: unknown): void {}
export function captureException(_error: unknown, _hint?: unknown): string {
  return "";
}
export function captureMessage(_message: string, _level?: unknown): string {
  return "";
}
export async function captureRequestError(..._args: unknown[]): Promise<void> {}
export function createTransport(_options: unknown, _makeRequest: unknown): any {
  return { send: async () => ({}), flush: async () => true };
}
export function getClient(): undefined {
  return undefined;
}
export function withScope<T>(callback: (scope: any) => T): T {
  return callback({ setTag() {}, setExtra() {}, setContext() {}, setUser() {} });
}
export function addBreadcrumb(_breadcrumb: unknown): void {}
export function flush(): Promise<boolean> {
  return Promise.resolve(true);
}
export type ErrorEvent = any;
export type EventHint = any;
export type Breadcrumb = any;
