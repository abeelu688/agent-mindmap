/**
 * Tests for `wrapCommand` error-handling wrapper.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../extension/src/notify", () => ({
  notify: vi.fn(),
}));

vi.mock("../../extension/src/errors", () => ({
  isCancellationError: (err: unknown) => err instanceof Error && err.name === "CancellationError",
}));

import { wrapCommand } from "../../extension/src/commands/commandWrapper";
import { notify } from "../../extension/src/notify";

describe("wrapCommand", () => {
  it("invokes the wrapped function with provided args", async () => {
    const inner = vi.fn().mockResolvedValue(undefined);
    const wrapped = wrapCommand(inner);

    await wrapped("a", 1, { x: true });

    expect(inner).toHaveBeenCalledWith("a", 1, { x: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("swallows cancellation errors silently", async () => {
    const cancelErr = new Error("cancelled");
    cancelErr.name = "CancellationError";
    const inner = vi.fn().mockRejectedValue(cancelErr);
    const wrapped = wrapCommand(inner);

    await wrapped();

    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies on non-cancellation errors", async () => {
    const inner = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = wrapCommand(inner);

    await wrapped();

    expect(notify).toHaveBeenCalledTimes(1);
    const errArg = (notify as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(errArg).toBeInstanceOf(Error);
    expect((errArg as Error).message).toBe("boom");
  });
});
