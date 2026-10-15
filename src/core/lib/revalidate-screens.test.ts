import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));

const { revalidateScreens } = await import("./revalidate-screens");

describe("revalidateScreens (6b.17a)", () => {
  beforeEach(() => revalidatePath.mockClear());

  it("re-reads the whole signed-in tree, layout and counts included", () => {
    revalidateScreens();
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
