import { afterEach, describe, expect, it, vi } from "vitest";

import { clearEditRequests, requestEdit, subscribeEditRequest } from "./edit-requests";

describe("edit requests (task 3.4)", () => {
  afterEach(() => clearEditRequests());

  it("starts editing a mounted record at once", () => {
    const onRequest = vi.fn();
    subscribeEditRequest("member", onRequest);
    requestEdit("member");
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps a request for a record that mounts later, and uses it once", () => {
    requestEdit("member");
    const first = vi.fn();
    const unsubscribe = subscribeEditRequest("member", first);
    expect(first).toHaveBeenCalledTimes(1);
    unsubscribe();
    const second = vi.fn();
    subscribeEditRequest("member", second);
    expect(second).not.toHaveBeenCalled();
  });

  it("only reaches the record with that key", () => {
    const other = vi.fn();
    subscribeEditRequest("client", other);
    requestEdit("member");
    expect(other).not.toHaveBeenCalled();
  });

  it("stops after unsubscribing", () => {
    const onRequest = vi.fn();
    const unsubscribe = subscribeEditRequest("member", onRequest);
    unsubscribe();
    requestEdit("member");
    expect(onRequest).not.toHaveBeenCalled();
  });
});
